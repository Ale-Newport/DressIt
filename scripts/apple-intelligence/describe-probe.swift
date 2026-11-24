import FoundationModels
import Foundation

@Generable struct GarmentGuess {
  @Guide(description: "Tipo de la prenda principal (identificador del vocabulario)") var subcategory: String
  @Guide(description: "Color principal en español, una o dos palabras (p. ej. 'azul marino')") var color: String
  @Guide(description: "Estampado (identificador del vocabulario)") var pattern: String
  @Guide(description: "Material probable (identificador del vocabulario) o 'desconocido'") var material: String
  @Guide(description: "Nombre corto y natural en español para un armario, 2 a 5 palabras, sin marca") var name: String
  @Guide(description: "Una frase que describa la prenda: tejido, corte y detalles visibles") var summary: String
  @Guide(description: "Objetos visibles que NO son la prenda (percha, maniquí, cuerda, persona, mueble…)") var otherObjects: [String]
}

let paths = CommandLine.arguments.dropFirst()
for p in paths {
  let session = LanguageModelSession(instructions: """
  Eres un asistente de armario. Identificas la prenda principal de una foto. Responde solo con lo que se ve; \
  si dudas, elige la opción más genérica. subcategory debe ser uno de: \(SUBS.joined(separator: ", ")). \
  pattern uno de: \(PATS.joined(separator: ", ")). material uno de: \(MATS.joined(separator: ", ")) o desconocido.
  """)
  let t0 = Date()
  do {
    let r = try await session.respond(generating: GarmentGuess.self) {
      "Describe la prenda principal de esta foto."
      Attachment(imageURL: URL(fileURLWithPath: p))
    }
    let g = r.content
    print(String(format: "%.1fs", Date().timeIntervalSince(t0)), (p as NSString).lastPathComponent.prefix(24), "|", g.subcategory, "|", g.color, "|", g.pattern, "|", g.material, "|", g.name, "|", g.summary, "|", g.otherObjects)
  } catch { print("ERR", p, error) }
}
