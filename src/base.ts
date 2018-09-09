import {Norman} from "./norman";
import {ModuleInfo} from "./module-info";


export class Base {
  public constructor(private _norman: Norman) {

  }


  public get norman() { return this._norman; }

  public get config() { return this._norman.config; }
}


export class ModuleBase extends Base {
  public constructor(norman: Norman, private _module: ModuleInfo) {
    super(norman);
  }


  public get module() { return this._module; }
}
