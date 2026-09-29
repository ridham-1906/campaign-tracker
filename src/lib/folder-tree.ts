// Groups the files from a `webkitdirectory` picker by the folder structure
// vendors actually export: <client>/<location>/<shot-type>.jpg. See
// components/folder-upload-wizard.tsx for how the result is reviewed and
// uploaded.

import { inferPhotoType, stripOrdinalPrefix } from "@/lib/folder-match";
import type { PhotoType } from "@/lib/attachments";

export type FolderFile = {
  file: File;
  /** Guessed from the filename — null when it doesn't match a known shot
   * type and the user needs to assign one. */
  photoType: PhotoType | null;
};

export type FolderGroup = {
  /** Folder name as it appears on disk, e.g. "1. Ambegaon D-Mart". */
  rawName: string;
  /** With any leading list-number stripped, e.g. "Ambegaon D-Mart". */
  cleanedName: string;
  files: FolderFile[];
};

export type ParsedFolder = {
  /** The folder the user actually picked, e.g. "Redcliff". */
  topFolderName: string;
  groups: FolderGroup[];
};

/**
 * A `webkitdirectory` picker hands back every file with a `webkitRelativePath`
 * like "Redcliff/1. Ambegaon D-Mart/GPS.jpeg" — nested arbitrarily deep, but
 * in practice one level: client folder, then one subfolder per location.
 *
 * Files land in a group keyed by their immediate parent folder. A file sitting
 * directly in the picked folder (no location subfolder at all — the simple
 * "one flat folder = one location" case) becomes its own single group named
 * after the top folder, so both shapes flow through the same review UI.
 */
export function parseFolderFiles(files: File[]): ParsedFolder {
  const topFolderName = files[0]?.webkitRelativePath?.split("/")[0] ?? "";
  const byFolder = new Map<string, File[]>();

  for (const file of files) {
    const parts = file.webkitRelativePath ? file.webkitRelativePath.split("/") : [];
    const folderName = parts.length > 2 ? parts[parts.length - 2] : topFolderName;
    const list = byFolder.get(folderName);
    if (list) list.push(file);
    else byFolder.set(folderName, [file]);
  }

  const groups: FolderGroup[] = Array.from(byFolder.entries()).map(
    ([rawName, groupFiles]) => ({
      rawName,
      cleanedName: stripOrdinalPrefix(rawName),
      files: groupFiles.map((file) => ({
        file,
        photoType: inferPhotoType(file.name),
      })),
    }),
  );

  return { topFolderName, groups };
}
