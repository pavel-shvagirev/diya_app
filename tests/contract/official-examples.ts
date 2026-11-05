/**
 * Response examples copied from the official Yandex Disk REST API reference, English edition
 * (https://yandex.com/dev/disk-api/doc/en/reference/…). They are the contract the client is
 * tested against: nothing here is invented. Where the reference gives only a placeholder (the
 * `_embedded` of a Resource, the items of a ResourceList) the object is assembled from the
 * documented samples and field lists, and the comment says so.
 *
 * Values elided by the reference itself ("...") are kept as they are.
 */

/** response-objects#resource: the Resource sample, without its `_embedded` placeholder. */
export const RESOURCE_FILE = {
  public_key: 'HQsmHLoeyBlJf8Eu1jlmzuU+ZaLkjPkgcvmoktUCIo8=',
  name: 'photo.png',
  created: '2014-04-21T14:57:13+04:00',
  custom_properties: { foo: '1', bar: '2' },
  public_url: 'https://yadi.sk/d/AaaBbb1122Ccc',
  origin_path: 'disk:/foo/photo.png',
  modified: '2014-04-21T14:57:14+04:00',
  path: 'disk:/foo/photo.png',
  md5: '4334dc6379c8f95ddf11b8508cfea271',
  type: 'file',
  mime_type: 'application/x-www-form-urlencoded',
  size: 34567,
};

/** response-objects#resourcelist: the ResourceList sample (items filled from the Resource fields). */
export const RESOURCE_LIST = {
  sort: '',
  public_key: 'HQsmHLoeyBlJf8Eu1jlmzuU+ZaLkjPkgcvmoktUCIo8=',
  items: [
    // "nested folders go first, followed by folder files" (response-objects#resourcelist)
    {
      name: 'Photos',
      path: 'disk:/foo/Photos',
      type: 'dir',
      created: '2014-04-21T14:57:13+04:00',
      modified: '2014-04-21T14:57:14+04:00',
    },
    RESOURCE_FILE,
    {
      name: 'notes.txt',
      path: 'disk:/foo/notes.txt',
      type: 'file',
      size: 12,
      md5: '9a0364b9e99bb480dd25e1f0284c8555',
      mime_type: 'text/plain',
      modified: '2014-04-22T10:00:00+04:00',
    },
  ],
  path: 'disk:/foo',
  limit: 20,
  offset: 0,
  total: 3,
};

/** A folder Resource whose `_embedded` is the ResourceList above (meta: "included only for folders"). */
export const RESOURCE_FOLDER = {
  name: 'foo',
  path: 'disk:/foo',
  type: 'dir',
  created: '2014-04-21T14:57:13+04:00',
  modified: '2014-04-21T14:57:14+04:00',
  _embedded: RESOURCE_LIST,
};

/** response-objects#resource, the `path` row: a resource in the trash carries an id suffix. */
export const TRASH_RESOURCE = {
  name: 'foo',
  path: 'trash:/foo_1408546879',
  origin_path: 'disk:/foo',
  type: 'file',
  size: 1,
  modified: '2014-04-21T14:57:14+04:00',
};

/** reference/upload: the Link sample for an upload URL. */
export const UPLOAD_LINK = {
  href: 'https://uploader1d.dst.yandex.net:443/upload-target/...',
  method: 'PUT',
  templated: false,
};

/** reference/content: the Link sample for a download URL. */
export const DOWNLOAD_LINK = {
  href: 'https://downloader.dst.yandex.ru/disk/...',
  method: 'GET',
  templated: false,
};

/** reference/create-folder, copy, move: 201, a Link to the created resource's meta information. */
export const RESOURCE_LINK = {
  href: 'https://cloud-api.yandex.net/v1/disk/resources?path=disk%3A%2FMusic',
  method: 'GET',
  templated: false,
};

/** reference/copy, move, delete: 202, a Link to the operation status (the query-string form). */
export const OPERATION_LINK_QUERY = {
  href: 'https://cloud-api.yandex.net/v1/disk/operations?id=33ca7d03ab21ct41b4a40182e78d828a3f8b72cdb5f4c0e94cc4b1449a63a2fe',
  method: 'GET',
  templated: false,
};

/** reference/operations: the request format `…/v1/disk/operations/<operation ID>` (the path form). */
export const OPERATION_LINK_PATH = {
  href: 'https://cloud-api.yandex.net/v1/disk/operations/33ca7d03ab21ct41b4a40182e78d828a3f8b72cdb5f4c0e94cc4b1449a63a2fe',
  method: 'GET',
  templated: false,
};

/** response-objects#operation and reference/operations: the three documented statuses. */
export const OPERATION_SUCCESS = { status: 'success' };
export const OPERATION_FAILED = { status: 'failed' };
export const OPERATION_IN_PROGRESS = { status: 'in-progress' };

/** reference/capacity and response-objects#disk: the Disk sample. */
export const DISK = {
  trash_size: 4631577437,
  total_space: 319975063552,
  used_space: 26157681270,
  system_folders: {
    applications: 'disk:/Applications',
    downloads: 'disk:/Downloads/',
  },
};

/** response-objects#error: the error object sample. */
export const ERROR_OBJECT = {
  description: 'resource already exists',
  error: 'PlatformResourceAlreadyExists',
};

/**
 * reference/all-files (https://yandex.com/dev/disk-api/doc/ru/reference/all-files): the
 * FilesResourceList sample, the response of `GET /v1/disk/resources/files`. Only files, no `total`.
 */
export const FILES_RESOURCE_LIST = {
  items: [
    {
      name: 'photo2.png',
      preview: 'https://downloader.disk.yandex.ru/preview/...',
      created: '2014-04-22T14:57:13+04:00',
      modified: '2014-04-22T14:57:14+04:00',
      path: 'disk:/foo/photo2.png',
      md5: '53f4dc6379c8f95ddf11b9508cfea271',
      type: 'file',
      mime_type: 'image/png',
      size: 54321,
    },
    {
      name: 'photo1.png',
      preview: 'https://downloader.disk.yandex.ru/preview/...',
      created: '2014-04-21T14:57:13+04:00',
      modified: '2014-04-21T14:57:14+04:00',
      path: 'disk:/foo/photo1.png',
      md5: '4334dc6379c8f95ddf11b9508cfea271',
      type: 'file',
      mime_type: 'image/png',
      size: 34567,
    },
  ],
  limit: 20,
  offset: 0,
};
