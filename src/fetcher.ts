import { Base } from "./base";


export default class ModuleFetcher extends Base {
  public async fetchModules() {
    for (let module of this.config.modules) {
      try {
        await module.fetch();
      } catch (error) {
        console.error(`Failed to fetch module: ${ error.message }`);
      }
    }
  }


  public async installModules() {
    await this.config.walkDependencyTree(this.config.modules, async module => {
      await module.install();
    });
  }
}
