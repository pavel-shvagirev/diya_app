import * as path from 'path';

import { ALLOWED_EXTERNAL_DOMAINS } from './constants.js';

/**
 * Resolve a target path against a base directory, ensuring the result
 * stays within the base.  Throws on path-traversal attempts.
 */
export function resolveSafePath(base: string, target: string): string {
  if (!base || !target) {
    throw new Error('Path resolution requires non-empty base and target');
  }

  const resolved = path.resolve(base, target);
  const baseResolved = path.resolve(base);

  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error('Path traversal attempt blocked');
  }

  return resolved;
}

/**
 * Validate a local file/folder path.
 * Rejects empty, absolute-escape, and traversal paths.
 */
export function validatePath(target: string): string {
  if (typeof target !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  const trimmed = target.trim();
  if (trimmed.length === 0) {
    throw new Error('Path cannot be empty');
  }

  // Reject obvious traversal patterns
  if (trimmed.startsWith('..') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new Error('Path cannot start with traversal');
  }

  return trimmed;
}

/**
 * Validate a local filesystem path that is expected to be absolute
 * (e.g. a sync pair's local root, chosen via a native folder picker).
 * Unlike validatePath() above, a leading '/' (POSIX) or drive letter
 * (Windows) is required and allowed; '..' traversal segments and null
 * bytes are still rejected.
 */
export function validateLocalPath(target: string): string {
  if (typeof target !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  const trimmed = target.trim();
  if (trimmed.length === 0) {
    throw new Error('Path cannot be empty');
  }

  if (trimmed.includes('..') || trimmed.includes('\0')) {
    throw new Error('Path cannot contain traversal segments');
  }

  const isAbsolutePosix = trimmed.startsWith('/');
  const isAbsoluteWindows = /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (!isAbsolutePosix && !isAbsoluteWindows) {
    throw new Error('Local path must be absolute');
  }

  return trimmed;
}

/**
 * Validate a remote Yandex.Disk resource path.
 *
 * Yandex.Disk resource paths are always absolute from disk root (e.g.
 * "/Folder/file.txt"), unlike local filesystem paths validated by
 * validatePath() above. This still rejects traversal segments and
 * control characters, but allows (and requires) the leading slash.
 */
export function validateRemotePath(target: string): string {
  if (typeof target !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  const trimmed = target.trim();
  if (trimmed.length === 0) {
    throw new Error('Path cannot be empty');
  }

  if (trimmed.includes('..') || trimmed.includes('\0')) {
    throw new Error('Path cannot contain traversal segments');
  }

  if (!trimmed.startsWith('/') && !trimmed.startsWith('disk:/')) {
    throw new Error('Remote path must be absolute (start with "/")');
  }

  return trimmed;
}

/**
 * Validate the name of one file or folder (for example the new name of a resource restored from
 * the trash): one path segment, no separators, no control characters, at most 255 characters.
 */
export function validateResourceName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new Error('Name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Name cannot be empty');
  }
  if (trimmed.length > 255) {
    throw new Error('Name is too long');
  }
  if (trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) {
    throw new Error('Name cannot be a path');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('Name cannot contain control characters');
  }
  return trimmed;
}

/**
 * Validate a URL.
 * Only allows https URLs to Yandex domains and cloud-api.yandex.net.
 */
export function validateUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  // Only HTTPS (check protocol first)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  // Only Yandex domains
  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_EXTERNAL_DOMAINS.map(d => d.toLowerCase());
  const isAllowed = allowed.some(domain => hostname === domain || hostname.endsWith('.' + domain));

  if (!isAllowed) {
    throw new Error(`URL domain not allowed: ${hostname}`);
  }

  return parsed.toString();
}
