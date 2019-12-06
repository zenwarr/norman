import { getServer, LocalNpmServer } from "../server";
import ModuleFetcher from "../fetcher";
import { getArgs } from "../arguments";


export async function fetchCommand() {
  const args = getArgs();

  if (args.subCommand !== "fetch") {
    return;
  }

  await LocalNpmServer.init();

  try {
    let fetcher = new ModuleFetcher();
    await fetcher.fetchModules();

    if (!args.noInstall) {
      await fetcher.installModules();
    }
  } finally {
    await getServer().stop();
  }
}
