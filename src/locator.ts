export class ServiceLocator {
  public initialize(name: string, service: unknown): void {
    if (this._services.has(name)) {
      throw new Error(`Service "${ name } already initialized`);
    }

    this._services.set(name, service);
  }

  public get<T>(name: string): T {
    const service = this._services.get(name);
    if (!service) {
      throw new Error(`Service ${ name } not found in service locator`);
    }

    return service as T;
  }

  public static get instance() {
    return this._instance;
  }

  private _services = new Map<string, unknown>();
  private static _instance = new ServiceLocator();
}
