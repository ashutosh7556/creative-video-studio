import { nanoid } from 'nanoid';

export const JOB_ID_RE = /^[A-Za-z0-9_-]{21}$/;
export const newJobId = (): string => nanoid();
/** Must pass before any id touches the filesystem (prevents path traversal). */
export const isValidJobId = (id: string): boolean => JOB_ID_RE.test(id);
