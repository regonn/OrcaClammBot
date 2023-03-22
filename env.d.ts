declare module "process" {
  global {
    namespace NodeJS {
      interface ProcessEnv {
        readonly HELLO_MOON_API_KEY: string;
      }
    }
  }
}
