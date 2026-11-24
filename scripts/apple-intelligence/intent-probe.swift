import FoundationModels
import Foundation

@Generable struct Intent {
  @Guide(description: "Qué pide: outfit (qué ponerse), trip (viaje/maleta), shopping (buscar o comprar un producto), gaps (qué le falta en el armario), weather (solo el tiempo), count (cuántas prendas tiene), other", .anyOf(["outfit", "trip", "shopping", "gaps", "weather", "count", "other"]))
  var kind: String
  @Guide(description: "Cuándo", .anyOf(["hoy", "manana", "pasado_manana", "dia_semana", "fecha", "sin_fecha"]))
  var when: String
  @Guide(description: "Día de la semana si when = dia_semana", .anyOf(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo", "ninguno"]))
  var weekday: String
  @Guide(description: "Día del mes si when = fecha, si no 0", .range(0...31))
  var dayOfMonth: Int
  @Guide(description: "Ocasión (identificador) o ninguna")
  var occasion: String
  @Guide(description: "Formalidad pedida: -1 más informal, 0 normal, 1 más formal", .range(-1...1))
  var formality: Int
  @Guide(description: "Abrigo pedido: -1 más fresco, 0 normal, 1 más abrigado", .range(-1...1))
  var warmth: Int
  @Guide(description: "Ciudad de destino del viaje tal como la escribe, o vacío")
  var destination: String
  @Guide(description: "Número de días del viaje, 0 si no se dice", .range(0...30))
  var days: Int
  @Guide(description: "Tipo de prenda mencionada (identificador) o ninguna")
  var subcategory: String
  @Guide(description: "Color mencionado en español o vacío")
  var color: String
  @Guide(description: "Precio máximo en euros, 0 si no se dice", .range(0...5000))
  var maxPrice: Int
  @Guide(description: "Prenda concreta del usuario que quiere incluir, copiada del texto (p. ej. 'mis pantalones negros'), o vacío")
  var garmentPhrase: String
  @Guide(description: "Tipos de prenda que NO quiere (identificadores)")
  var exclude: [String]
}

@main struct Main {
  static func main() async throws {
    let tests = [
      "¿Qué me pongo mañana para ir a trabajar?",
      "Necesito ropa para un viaje de cuatro días a Lisboa",
      "el viernes tengo una boda y no quiero llevar tacones",
      "algo cómodo para el sábado que voy de excursión al monte",
      "quiero ir arreglada esta noche a cenar con mis pantalones negros",
      "búscame unas zapatillas blancas por menos de 80 euros",
      "¿va a llover pasado mañana?",
      "¿qué me falta en el armario para tener más conjuntos?",
      "cuántas camisas tengo",
      "me voy el finde a la playa a Valencia",
      "tengo una entrevista el 3 y quiero ir más formal pero sin corbata",
      "hace un frío que pela, dame algo abrigado para la uni",
    ]
    for t in tests {
      let s = LanguageModelSession(instructions: """
      Conviertes peticiones en español de una app de armario en datos estructurados. No respondes al usuario. \
      Ocasiones válidas: \(OCCS.joined(separator: ", ")). Tipos de prenda válidos: \(SUBS.joined(separator: ", ")). \
      Usa solo identificadores de esas listas; si no encaja ninguno, 'ninguna'. No inventes datos que no estén en el texto.
      """)
      let t0 = Date()
      let r = try await s.respond(to: t, generating: Intent.self, options: GenerationOptions(sampling: .greedy))
      let i = r.content
      print(String(format: "%.1fs", Date().timeIntervalSince(t0)), "«\(t)» →", i.kind, i.when, i.weekday, i.dayOfMonth, "occ=\(i.occasion)", "f=\(i.formality) w=\(i.warmth)", "dest=\(i.destination) d=\(i.days)", "sub=\(i.subcategory) col=\(i.color) max=\(i.maxPrice)", "g=\(i.garmentPhrase)", "ex=\(i.exclude)")
    }
  }
}
