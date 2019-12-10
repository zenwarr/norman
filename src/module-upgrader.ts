import { ModuleNpmRunner } from "./module-npm-runner";


export class ModuleUpgrader extends ModuleNpmRunner {
  public async getOutdated(): Promise<any> {
    let result = await this.run([ "outdated", "--json" ], {
      ignoreExitCode: true,
      collectOutput: true,
      silent: true
    });

    result = result ? result.trim() : result;
    if (result) {
      let resultObj = JSON.parse(result);

      for (let dep of Object.keys(resultObj)) {
        let depData = resultObj[dep];
        if (depData.current === "linked") {
          delete resultObj[dep];
        }
      }

      return resultObj;
    }
    return {};
  }


  public async upgradeDependency(pkg: string, version: string): Promise<void> {
    await this.run([ "install", `${ pkg }@${ version }` ]);
  }
}
