export const documentLimits = Object.freeze({ title: 180, description: 4000 });

export function documentMetadata(input) {
  return Object.fromEntries(Object.keys(documentLimits).map(field => [field, typeof input?.[field] === "string" ? input[field].trim() : ""]));
}

export function documentMetadataErrors(input) {
  const metadata = documentMetadata(input);
  return Object.fromEntries(Object.entries(documentLimits).flatMap(([field, limit]) =>
    !metadata[field] ? [[field, "Campo obrigatório."]]
      : metadata[field].length > limit ? [[field, `Use no máximo ${limit} caracteres.`]] : []));
}
