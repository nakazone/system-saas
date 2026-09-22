export type StoredObject = {
  key: string;
  url: string;
  contentType: string;
  size: number;
};

export interface ObjectStorage {
  upload(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}
