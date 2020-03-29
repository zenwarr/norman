import { ModuleSubset } from "./module-subset";
import * as path from "path";
import * as packlist from "npm-packlist";


/**
 * Subset of files that are going to be published to npm.
 */
export class PublishDependenciesSubset extends ModuleSubset {
  public getName(): string {
    return "publish";
  }


  public async isFileIncluded(filename: string): Promise<boolean> {
    let relpath = path.relative(this.mod.path, filename);
    if (relpath === ".npmignore" || relpath === ".gitignore") {
      // this files are not actually published, but they affect list of files to be published
      return true;
    }

    let list: string[];

    if (!PublishDependenciesSubset._packListCache.has(this.dirPath)) {
      list = await packlist({ path: this.dirPath });
      list = list.map(file => path.resolve(this.dirPath, file));

      PublishDependenciesSubset._packListCache.set(this.dirPath, list);
    } else {
      list = PublishDependenciesSubset._packListCache.get(this.dirPath)!;
    }

    const inPackList = list.includes(filename);
    if (inPackList && this.mod.customIgnoreInstance) {
      return !this.mod.customIgnoreInstance.ignores(relpath);
    }

    return inPackList;
  }


  private static _packListCache = new Map<string, string[]>();
}
