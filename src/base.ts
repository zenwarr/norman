import { ModuleInfo } from "./module-info";


export class ModuleOperator {
  public constructor(private _module: ModuleInfo) {

  }


  public get module() {
    return this._module;
  }
}
