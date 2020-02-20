import { ModuleInfo } from "./module-info";
import { NpmRunner } from "./module-npm-runner";


export namespace ModuleUpgrade {
  export async function getOutdated(module: ModuleInfo): Promise<any> {
    let result = await NpmRunner.run(module, [ "outdated", "--json" ], {
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


  export async function upgradeDependency(module: ModuleInfo, pkg: string, version: string): Promise<void> {
    await NpmRunner.run(module, [ "install", `${ pkg }@${ version }` ]);
  }
}
