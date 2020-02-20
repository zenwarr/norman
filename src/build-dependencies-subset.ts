import { ModuleSubset } from "./module-subset";
import { ModuleInfo } from "./module-info";
import * as mimimatch from "minimatch";


export class BuildDependenciesSubset extends ModuleSubset {
  public getName() {
    return "build";
  }


  public isFileIncluded(module: ModuleInfo, filename: string): boolean {
    if (!module.buildTriggers || !module.buildTriggers.length) {
      return true;
    }

    for (let pattern of module.buildTriggers) {
      if (mimimatch(filename, pattern, { matchBase: true })) {
        return true;
      }
    }

    return false;
  }
}
