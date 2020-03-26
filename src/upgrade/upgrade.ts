import { LocalModule } from "../local-module";
import { NpmRunner } from "../module-npm-runner";


export async function getOutdated(module: LocalModule): Promise<any> {
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


export async function upgradeDependency(module: LocalModule, pkg: string, version: string): Promise<void> {
  await NpmRunner.run(module, [ "install", `${ pkg }@${ version }` ]);
}
