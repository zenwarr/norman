import { ModuleSubset } from "./module-subset";
import { ModuleInfo } from "./module-info";
import * as path from "path";


export class PublishDependenciesSubset extends ModuleSubset {
  public getName(): string {
    return "publish";
  }


  public isFileIncluded(module: ModuleInfo, filename: string): boolean {
    let relativeSourceFileName = path.relative(module.path, filename);
    if (relativeSourceFileName === ".gitignore" || relativeSourceFileName === ".npmignore") {
      return false;
    }

    if (module.isIgnoredByRules(filename) || !module.isModuleFile(filename)) {
      return false;
    }

    return true;
  }
}
