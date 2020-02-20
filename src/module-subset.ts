import { ModuleInfo } from "./module-info";


export abstract class ModuleSubset {
  public abstract isFileIncluded(module: ModuleInfo, filename: string): boolean;
  public abstract getName(): string;
}
