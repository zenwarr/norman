import { FileTransformerPlugin, SourceMapPlugin } from "./plugin";
import { ServiceLocator } from "./locator";


export class PluginManager {
  public get plugins() {
    return this._plugins;
  }


  private _plugins: FileTransformerPlugin[] = [ new SourceMapPlugin() ];


  protected constructor() {

  }


  public static init() {
    const manager = new PluginManager();
    ServiceLocator.instance.initialize("plugins", manager);
  }
}


export function getPluginManager() {
  return ServiceLocator.instance.get<PluginManager>("plugins");
}
