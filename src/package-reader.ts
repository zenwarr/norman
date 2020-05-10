import * as fs from "fs-extra";
import * as path from "path";
import { ServiceLocator } from "./locator";


export class PackageReader {
  public readPackageMetadata(dirPath: string): any {
    let filePath = path.join(dirPath, "package.json");

    if (this._metadataCache.has(filePath)) {
      return this._metadataCache.get(filePath)!;
    }

    let metadata = fs.readJSONSync(filePath);
    if (typeof metadata !== "object") {
      throw new Error(`Expected contents of ${ filePath } to be object`);
    }

    this._metadataCache.set(filePath, metadata);
    return metadata;
  }

  public static init() {
    ServiceLocator.instance.initialize("packageReader", new PackageReader());
  }

  private _metadataCache = new Map<string, object>();
}


export function getPackageReader() {
  return ServiceLocator.instance.get<PackageReader>("packageReader");
}
