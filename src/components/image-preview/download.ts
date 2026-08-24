"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AttachmentView } from "@/lib/view-types";

/** Parallel fetches while zipping — enough to hide latency, not enough to
 * open a socket per file on a location with dozens of photos. */
const ZIP_CONCURRENCY = 4;

/** Strip characters a zip entry (or a filesystem) would rather not see. */
export function safeName(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, "-");
}

/** A hidden link click, so a single file streams straight to disk instead of
 * being buffered into a blob first — a 100MB deck costs no memory this way. */
function saveUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  saveUrl(url, filename);
  URL.revokeObjectURL(url);
}

/**
 * Two uploads can share a filename, and JSZip would silently keep only the
 * last. Names are reserved up front, in list order, so the mapping stays stable
 * no matter what order the fetches finish in.
 */
function uniqueNames(items: AttachmentView[]) {
  const used = new Set<string>();
  return items.map((item) => {
    let name = safeName(item.filename);
    for (let n = 2; used.has(name); n += 1) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      name = `${base} (${n})${ext}`;
    }
    used.add(name);
    return { item, name };
  });
}

/** Saves one file directly and bundles several into a zip, with progress. */
export function useAttachmentDownload() {
  const [zipping, setZipping] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  async function download(items: AttachmentView[], zipName: string) {
    if (items.length === 0 || zipping) return;

    if (items.length === 1) {
      // `?download=1` rather than the `download` attribute below: the route
      // redirects to Appwrite, and browsers drop that attribute across an
      // origin change, so the disposition has to come from Appwrite itself.
      saveUrl(`${items[0].url}?download=1`, safeName(items[0].filename));
      return;
    }

    setZipping(true);
    setDone(0);
    setTotal(items.length);
    try {
      // Loaded on demand — the zip library is dead weight on every other page.
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      // Bounded concurrency rather than one-at-a-time: each file is a separate
      // round trip, so serialising them made a 20-image bundle take 20× the
      // latency. The zip is built entirely in the browser and the bytes come
      // straight from Appwrite, so bundle size is bounded by memory here, not
      // by any serverless response limit.
      const queue = uniqueNames(items);
      await Promise.all(
        Array.from({ length: Math.min(ZIP_CONCURRENCY, queue.length) }, async () => {
          for (;;) {
            const next = queue.shift();
            if (!next) return;
            const res = await fetch(next.item.url);
            if (!res.ok) throw new Error(`Could not fetch ${next.item.filename}`);
            zip.file(next.name, await res.blob());
            setDone((n) => n + 1);
          }
        }),
      );

      const blob = await zip.generateAsync({
        type: "blob",
        // Images and PPTX are already compressed — deflating them burns CPU to
        // save almost nothing.
        compression: "STORE",
      });
      saveBlob(blob, `${safeName(zipName)}.zip`);
      toast.success(`${items.length} files zipped`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build the zip");
    } finally {
      setZipping(false);
    }
  }

  return { zipping, done, total, download };
}
