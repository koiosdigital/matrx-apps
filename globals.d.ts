// Ambient globals available inside render isolates.
declare function atob(data: string): string;
declare function btoa(data: string): string;

// Binary assets import as bytes (matrx bundler loader: "binary").
declare module "*.png" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.gif" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.webp" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.jpg" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.jpeg" {
  const bytes: Uint8Array;
  export default bytes;
}
