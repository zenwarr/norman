import {ModuleSubset} from "./module-subset";


/**
 * Subset of all files in module (expect ones inside known ignored directories).
 */
export class AllFilesSubset extends ModuleSubset {
  public getName(): string {
    return "sources";
  }


  public async isFileIncluded(filename: string): Promise<boolean> {
    return true;
  }
}
