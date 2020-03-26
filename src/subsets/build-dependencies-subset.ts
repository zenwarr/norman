import { ModuleSubset } from "./module-subset";
import * as mimimatch from "minimatch";


/**
 * Subset of files that should trigger a module rebuild
 */
export class BuildDependenciesSubset extends ModuleSubset {
  public getName() {
    return "build";
  }


  public async isFileIncluded(filename: string): Promise<boolean> {
    return this.mod.buildTriggers.some(pattern => mimimatch(filename, pattern, { matchBase: true }));
  }
}
