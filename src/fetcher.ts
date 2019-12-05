import {Base} from "./base";


export default class ModuleFetcher extends Base {
  public async fetchModules() {
    for (let module of this.config.modules) {
      await module.fetch();
    }
  }


  public async installModules() {
    await this.config.walkDependencyTree(this.config.modules, async module => {
      await module.install();
    });
  }
}
