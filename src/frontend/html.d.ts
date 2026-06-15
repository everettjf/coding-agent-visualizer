declare module "*.html" {
  const content: import("bun").HTMLBundle;
  export default content;
}
