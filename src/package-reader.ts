import * as fs from "fs-extra";
import * as path from "path";
import { ServiceLocator } from "./locator";


export class PackageReader {
  public readPackageMetadata(dirPath: string): any | undefined {
    let filePath = path.join(dirPath, "package.json");

    if (this._metadataCache.has(filePath)) {
      return this._metadataCache.get(filePath)!;
    }

    let metadata: object | undefined;
    try {
      metadata = fs.readJSONSync(filePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        metadata = undefined;
      } else {
        throw error;
      }
    }

    if (metadata && typeof metadata !== "object") {
      throw new Error(`Expected contents of ${ filePath } to be object`);
    }

    this._metadataCache.set(filePath, metadata);
    return metadata;
  }

  public static init() {
    ServiceLocator.instance.initialize("packageReader", new PackageReader());
  }

  private _metadataCache = new Map<string, object | undefined>();
}


export function getPackageReader() {
  return ServiceLocator.instance.get<PackageReader>("packageReader");
}
