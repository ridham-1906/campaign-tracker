// Builds an execution deck by grafting new slides onto the uploaded
// `Execution PPT Outdoor.pptx` template rather than generating one from
// scratch — that's the only way the export keeps the client's exact branding
// (embedded Play/Geom fonts, logo, colors) byte-for-byte. A pptx is just a
// zip of XML parts, so this is package surgery: read the template with
// JSZip, drop the one example location slide (slide3 + its sample photo),
// splice in one generated slide per *photo* — matching the template's
// one-photo-per-slide layout, with the location's info table repeated on
// each of its photos' slides — and patch the three parts that list what
// slides exist ([Content_Types].xml, presentation.xml,
// presentation.xml.rels). The exact same approach was prototyped and
// structurally validated (every relationship/override resolves, every XML
// part is well-formed) before porting here.
import { PHOTO_TYPE_LABELS, type AttachmentStage } from "@/lib/attachments";
import type { AttachmentView, LocationPreview } from "@/lib/view-types";
import { formatDate } from "@/lib/campaign";

const TEMPLATE_URL = "/Execution PPT Outdoor.pptx";

const SLIDE_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

/** The template's photo placement on its one example slide — reused as the
 * bounding box each photo's own slide fits its photo into. */
const PHOTO_BOX = { x: 2755025, y: 195425, w: 6360073, h: 4588225 };

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

export type LocationExportEntry = {
  location: LocationPreview;
  /** Already filtered to the chosen photo-type(s) and guaranteed non-empty —
   * the caller drops any location with no match rather than handing it here. */
  photos: AttachmentView[];
};

export type ExportProgress = { done: number; total: number };

/** Bounded concurrency for fetching photo bytes, matching the zip-download
 * flow — enough to hide per-file latency without opening a socket per photo. */
const FETCH_CONCURRENCY = 4;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

type PhotoAsset = { bytes: ArrayBuffer; ext: string; aspect: number };

async function loadPhotoAsset(attachment: AttachmentView): Promise<PhotoAsset> {
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Could not fetch ${attachment.filename}`);
  const blob = await res.blob();
  const bytes = await blob.arrayBuffer();
  const ext = extFromMime(attachment.mimeType);

  let aspect = 4 / 3;
  try {
    const bitmap = await createImageBitmap(blob);
    aspect = bitmap.width / bitmap.height;
    bitmap.close();
  } catch {
    // Dimensions are cosmetic (avoids stretching) — a bad decode still
    // produces a usable slide, just center-cropped as a 4:3 guess.
  }
  return { bytes, ext, aspect };
}

/** Fetches every photo across every location with bounded concurrency,
 * reporting overall progress as they land. */
async function loadAllPhotos(
  entries: LocationExportEntry[],
  onProgress?: (progress: ExportProgress) => void,
): Promise<PhotoAsset[][]> {
  const results: PhotoAsset[][] = entries.map((e) => new Array(e.photos.length));
  const jobs: { entryIndex: number; photoIndex: number }[] = [];
  entries.forEach((e, entryIndex) => {
    e.photos.forEach((_, photoIndex) => jobs.push({ entryIndex, photoIndex }));
  });

  let done = 0;
  const total = jobs.length;
  onProgress?.({ done, total });

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, jobs.length) }, async () => {
      for (;;) {
        const job = jobs[cursor];
        cursor += 1;
        if (!job) return;
        const attachment = entries[job.entryIndex].photos[job.photoIndex];
        results[job.entryIndex][job.photoIndex] = await loadPhotoAsset(attachment);
        done += 1;
        onProgress?.({ done, total });
      }
    }),
  );

  return results;
}

type Rect = { x: number; y: number; w: number; h: number };

/** Fits a photo within its cell without distorting it — width- or
 * height-constrained depending on which side of the aspect ratio it falls. */
function fitContain(cell: Rect, aspect: number): Rect {
  const cellAspect = cell.w / cell.h;
  let w: number;
  let h: number;
  if (aspect > cellAspect) {
    w = cell.w;
    h = w / aspect;
  } else {
    h = cell.h;
    w = h * aspect;
  }
  return {
    x: Math.round(cell.x + (cell.w - w) / 2),
    y: Math.round(cell.y + (cell.h - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

function buildLocationSlideXml(params: {
  header: string;
  mediaType: string;
  dateFieldLabel: string;
  dateValueLabel: string;
  photoTypeLabel: string;
  photo: { rId: string; aspect: number };
}): string {
  const { header, mediaType, dateFieldLabel, dateValueLabel, photoTypeLabel, photo } = params;
  const rect = fitContain(PHOTO_BOX, photo.aspect);

  const pic =
    `<p:pic><p:nvPicPr><p:cNvPr id="20" name="Photo"/>` +
    `<p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill rotWithShape="1"><a:blip r:embed="${photo.rId}"><a:alphaModFix/></a:blip>` +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${rect.x}" y="${rect.y}"/><a:ext cx="${rect.w}" cy="${rect.h}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:ln w="9525"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:ln></p:spPr></p:pic>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${SLIDE_NS}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name="Shape 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Logo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
    `<a:xfrm><a:off x="11070734" y="211006"/><a:ext cx="870933" cy="870933"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:blipFill rotWithShape="1"><a:blip r:embed="rId2"><a:alphaModFix/></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>` +
    `<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>` +
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="Bottom line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr><a:xfrm><a:off x="32826" y="6725163"/><a:ext cx="12192000" cy="0"/></a:xfrm>` +
    `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>` +
    `<a:ln w="390525"><a:solidFill><a:srgbClr val="351E29"/></a:solidFill><a:prstDash val="solid"/></a:ln></p:spPr></p:cxnSp>` +
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="4" name="Top line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr><a:xfrm><a:off x="0" y="31353"/><a:ext cx="12192000" cy="0"/></a:xfrm>` +
    `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>` +
    `<a:ln w="38100"><a:solidFill><a:srgbClr val="EE4A4B"/></a:solidFill><a:prstDash val="solid"/></a:ln></p:spPr></p:cxnSp>` +
    pic +
    `<p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="9685432" y="6608520"/><a:ext cx="2374583" cy="233269"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr anchor="t" wrap="square"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>` +
    `<a:r><a:rPr lang="en-US" sz="1400"><a:solidFill><a:srgbClr val="FCF7F3"/></a:solidFill>` +
    `<a:latin typeface="Geom"/></a:rPr><a:t>www.excellentpublicity.com</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Info table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="408025" y="4965550"/><a:ext cx="11375950" cy="1285875"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>` +
    `<a:tblPr><a:noFill/><a:tableStyleId>{C9C7AF9B-F15D-4EA0-B89F-FEA0F61E90E1}</a:tableStyleId></a:tblPr>` +
    `<a:tblGrid><a:gridCol w="5687975"/><a:gridCol w="5687975"/></a:tblGrid>` +
    `<a:tr h="542925"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/>` +
    `<a:r><a:rPr b="1" lang="en-US" sz="1600"><a:solidFill><a:srgbClr val="FCF7F3"/></a:solidFill></a:rPr><a:t>${escapeXml(header)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marT="91425" marB="91425" marR="91425" marL="91425"><a:solidFill><a:schemeClr val="dk1"/></a:solidFill></a:tcPr></a:tc>` +
    `<a:tc hMerge="1"/></a:tr>` +
    `<a:tr h="371475"><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:r><a:rPr b="1" lang="en-US" sz="1600"/><a:t>Media Type : </a:t></a:r>` +
    `<a:r><a:rPr lang="en-US" sz="1600"/><a:t>${escapeXml(mediaType)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marT="91425" marB="91425" marR="91425" marL="91425"/></a:tc>` +
    `<a:tc hMerge="1"/></a:tr>` +
    `<a:tr h="371475"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:r><a:rPr b="1" lang="en-US" sz="1600"/><a:t>${escapeXml(dateFieldLabel)} : </a:t></a:r>` +
    `<a:r><a:rPr lang="en-US" sz="1600"/><a:t>${escapeXml(dateValueLabel)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marT="91425" marB="91425" marR="91425" marL="91425"/></a:tc>` +
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:r><a:rPr b="1" lang="en-US" sz="1600"/><a:t>Photo Type : </a:t></a:r>` +
    `<a:r><a:rPr lang="en-US" sz="1600"/><a:t>${escapeXml(photoTypeLabel)}</a:t></a:r></a:p></a:txBody>` +
    `<a:tcPr marT="91425" marB="91425" marR="91425" marL="91425"/></a:tc></a:tr>` +
    `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

function buildLocationSlideRels(photoRels: { rId: string; target: string }[]): string {
  const rels =
    `<Relationship Id="rId1" Type="${REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_NS}/image" Target="../media/image1.png"/>` +
    photoRels
      .map((p) => `<Relationship Id="${p.rId}" Type="${REL_NS}/image" Target="${p.target}"/>`)
      .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

/** What the "Photo Type" cell reads for one photo's slide — that photo's own
 * tag, or "Other" for an untagged one rather than silently leaving it blank. */
function photoTypeLabelOf(photo: AttachmentView): string {
  return photo.photoType ? PHOTO_TYPE_LABELS[photo.photoType] : "Other";
}

/** Renders a location's header/media fields the way the table cells expect
 * them, given only what a location preview actually carries. */
function locationFields(location: LocationPreview) {
  return {
    header: `${location.city} · ${location.location}`,
    mediaType: location.type,
  };
}

/** Row label for each install stage — distinct from attachments.ts's
 * STAGE_LABELS ("Installation"/"Mid date"/"End date"), since the deck wants
 * "Start Date"/"Mid Date"/"End Date" specifically. */
const STAGE_DATE_FIELD_LABELS: Record<AttachmentStage, string> = {
  installation: "Start Date",
  mid_date: "Mid Date",
  end_date: "End Date",
};

/** Which of the location's three dates belongs on this photo's slide — keyed
 * off the photo's own stage, not a fixed per-location value, since a single
 * location's photos can span all three stages across their own slides. */
function dateRowFor(photo: AttachmentView, location: LocationPreview) {
  const stage = photo.stage ?? "installation"; // untagged/legacy photos: preserve prior behavior
  const raw =
    stage === "installation"
      ? location.startDate
      : stage === "mid_date"
        ? location.midDate
        : location.endDate;
  return {
    fieldLabel: STAGE_DATE_FIELD_LABELS[stage],
    valueLabel: raw ? formatDate(raw) : "—",
  };
}

export async function buildExecutionPpt({
  campaignName,
  entries,
  onProgress,
}: {
  campaignName: string;
  entries: LocationExportEntry[];
  onProgress?: (progress: ExportProgress) => void;
}): Promise<Blob> {
  const { default: JSZip } = await import("jszip");

  const [templateRes, photoAssets] = await Promise.all([
    fetch(encodeURI(TEMPLATE_URL)),
    loadAllPhotos(entries, onProgress),
  ]);
  if (!templateRes.ok) throw new Error("Could not load the execution deck template");
  const zip = await JSZip.loadAsync(await templateRes.arrayBuffer());

  const readText = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`Template is missing ${path}`);
    return file.async("string");
  };

  const presentationRels = await readText("ppt/_rels/presentation.xml.rels");
  const slide3RelMatch = presentationRels.match(
    /<Relationship Id="(rId\d+)"[^>]*Target="slides\/slide3\.xml"[^>]*\/>/,
  );
  if (!slide3RelMatch) {
    throw new Error("Template's location-slide template (slide3) was not found");
  }
  const [slide3RelTag, slide3RelId] = slide3RelMatch;

  // Drop the template's one example location slide and its sample photo —
  // every location gets a freshly generated slide instead.
  zip.remove("ppt/slides/slide3.xml");
  zip.remove("ppt/slides/_rels/slide3.xml.rels");
  zip.remove("ppt/media/image2.jpg");

  const slide2 = await readText("ppt/slides/slide2.xml");
  const CAMPAIGN_NAME_PLACEHOLDER = "<a:t>Campaign Name </a:t>";
  if (!slide2.includes(CAMPAIGN_NAME_PLACEHOLDER)) {
    throw new Error("Template's campaign-name slide (slide2) has changed shape");
  }
  zip.file(
    "ppt/slides/slide2.xml",
    slide2.replace(CAMPAIGN_NAME_PLACEHOLDER, `<a:t>${escapeXml(campaignName)}</a:t>`),
  );

  const newSlideParts: string[] = [];
  const newPresRels: { id: string; target: string }[] = [];
  const newSldIds: { id: string; relId: string }[] = [];

  // One slide per photo, not per location — a location with several matching
  // photos gets one slide each, its info table repeated on every one, rather
  // than cramming them together onto a single crowded slide.
  let slideIndex = 0;
  entries.forEach((entry, entryIndex) => {
    const fields = locationFields(entry.location);

    entry.photos.forEach((photoAttachment, photoIndex) => {
      const asset = photoAssets[entryIndex][photoIndex];
      const photoRel = {
        rId: "rId3",
        target: `../media/locphoto_${slideIndex}.${asset.ext}`,
        mediaPath: `ppt/media/locphoto_${slideIndex}.${asset.ext}`,
      };

      const slidePath = `ppt/slides/loc${slideIndex}.xml`;
      const relsPath = `ppt/slides/_rels/loc${slideIndex}.xml.rels`;

      const { fieldLabel, valueLabel } = dateRowFor(photoAttachment, entry.location);

      zip.file(
        slidePath,
        buildLocationSlideXml({
          ...fields,
          dateFieldLabel: fieldLabel,
          dateValueLabel: valueLabel,
          photoTypeLabel: photoTypeLabelOf(photoAttachment),
          photo: { rId: photoRel.rId, aspect: asset.aspect },
        }),
      );
      zip.file(relsPath, buildLocationSlideRels([photoRel]));
      zip.file(photoRel.mediaPath, asset.bytes);

      newSlideParts.push(`/${slidePath}`);
      const relId = `rId${2000 + slideIndex}`;
      newPresRels.push({ id: relId, target: `slides/loc${slideIndex}.xml` });
      newSldIds.push({ id: String(3000 + slideIndex), relId });

      slideIndex += 1;
    });
  });

  // presentation.xml.rels: swap the slide3 relationship for the new slides.
  const extraRels = newPresRels
    .map((r) => `<Relationship Id="${r.id}" Type="${REL_NS}/slide" Target="${r.target}"/>`)
    .join("");
  const updatedPresRels = presentationRels
    .replace(slide3RelTag, "")
    .replace("</Relationships>", `${extraRels}</Relationships>`);
  zip.file("ppt/_rels/presentation.xml.rels", updatedPresRels);

  // presentation.xml: swap slide3's sldId entry for one per generated slide.
  const presentation = await readText("ppt/presentation.xml");
  const oldSldIdTag = new RegExp(`<p:sldId id="\\d+" r:id="${slide3RelId}"/>`);
  if (!oldSldIdTag.test(presentation)) {
    throw new Error("Template's slide list has changed shape");
  }
  const newSldIdXml = newSldIds
    .map((s) => `<p:sldId id="${s.id}" r:id="${s.relId}"/>`)
    .join("");
  zip.file("ppt/presentation.xml", presentation.replace(oldSldIdTag, newSldIdXml));

  // [Content_Types].xml: drop slide3's override, add one per generated slide,
  // and declare any embedded extension the template didn't already know
  // about (webp uploads, since the template only ships jpg/png defaults).
  let contentTypes = await readText("[Content_Types].xml");
  contentTypes = contentTypes.replace(
    /<Override ContentType="[^"]*presentationml\.slide\+xml" PartName="\/ppt\/slides\/slide3\.xml"\/>/,
    "",
  );
  const extraOverrides = newSlideParts
    .map((p) => `<Override ContentType="${SLIDE_CONTENT_TYPE}" PartName="${p}"/>`)
    .join("");
  contentTypes = contentTypes.replace("</Types>", `${extraOverrides}</Types>`);

  const usedExts = new Set(photoAssets.flat().map((a) => a.ext));
  const extraDefaults: string[] = [];
  if (usedExts.has("webp") && !/Extension="webp"/.test(contentTypes)) {
    extraDefaults.push('<Default ContentType="image/webp" Extension="webp"/>');
  }
  if (extraDefaults.length > 0) {
    contentTypes = contentTypes.replace(/(<Types[^>]*>)/, `$1${extraDefaults.join("")}`);
  }
  zip.file("[Content_Types].xml", contentTypes);

  return zip.generateAsync({ type: "blob" });
}
