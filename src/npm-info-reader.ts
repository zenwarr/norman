import { getNpmViewInfo, NpmViewInfo } from "./sync/npm-view";
import { LocalModule } from "./local-module";
import { ServiceLocator } from "./locator";


export class NpmInfoReader {
  public async getNpmInfo(mod: LocalModule): Promise<NpmViewInfo> {
    if (this._cache.has(mod)) {
      return this._cache.get(mod)!;
    }

    let info = await getNpmViewInfo(mod);

    this._cache.set(mod, info);

    return info;
  }

  public invalidate(mod: LocalModule) {
    this._cache.delete(mod);
  }

  public static init() {
    ServiceLocator.instance.initialize("npmInfoReader", new NpmInfoReader());
  }

  private _cache = new Map<LocalModule, NpmViewInfo>();
}


export function getNpmInfoReader() {
  return ServiceLocator.instance.get<NpmInfoReader>("npmInfoReader");
}
