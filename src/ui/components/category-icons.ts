import {
  Archive,
  AudioLines,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Video,
} from 'lucide-react';
import type { Category } from '../../domain/model';

/** One icon per file type, used wherever a file is listed (20 px, never inside a tile). */
export const categoryIcons: Record<Category, typeof FileIcon> = {
  Documents: FileText,
  Archives: Archive,
  Videos: Video,
  Audio: AudioLines,
  Images: ImageIcon,
  Software: LayoutGrid,
  Other: FileIcon,
};
