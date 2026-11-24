import CoreImage
import ExpoModulesCore
import Foundation
import Vision
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device helpers. Nothing here leaves the phone: Apple's Foundation Models run locally and
/// Vision's subject lifting is a local request. Every entry point checks availability and fails
/// with a clear error code so the app can fall back to the server or hide the feature.
public final class DressItIntelligenceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DressItIntelligence")

    Function("getStatus") { () -> [String: Any] in
      var status: [String: Any] = [
        "model": "unsupportedOS",
        "vision": false,
        "spanish": false,
        "subjectLifting": false,
        "osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
      ]
      if #available(iOS 17.0, *) { status["subjectLifting"] = true }
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available: status["model"] = "available"
        case .unavailable(.deviceNotEligible): status["model"] = "deviceNotEligible"
        case .unavailable(.appleIntelligenceNotEnabled): status["model"] = "appleIntelligenceNotEnabled"
        case .unavailable(.modelNotReady): status["model"] = "modelNotReady"
        case .unavailable: status["model"] = "unavailable"
        }
        status["spanish"] = model.supportsLocale(Locale(identifier: "es_ES"))
        if #available(iOS 27.0, *) {
          status["vision"] = model.isAvailable && model.capabilities.contains(.vision)
        }
      }
      #endif
      return status
    }

    AsyncFunction("extractIntent") { (text: String, occasions: [String], subcategories: [String], today: String) async throws -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await OnDeviceLanguage.extractIntent(text: text, occasions: occasions, subcategories: subcategories, today: today)
      }
      #endif
      throw Exception(name: "ERR_UNAVAILABLE", description: "El modelo de Apple Intelligence no está disponible en este dispositivo.")
    }

    AsyncFunction("describeGarment") { (uri: String, typeLabel: String?) async throws -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 27.0, *) {
        return try await OnDeviceLanguage.describeGarment(url: try fileURL(uri), typeLabel: typeLabel)
      }
      #endif
      throw Exception(name: "ERR_UNAVAILABLE", description: "Describir imágenes en el dispositivo necesita iOS 27 y Apple Intelligence.")
    }

    AsyncFunction("summarize") { (facts: String, style: String) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        return try await OnDeviceLanguage.summarize(facts: facts, style: style)
      }
      #endif
      throw Exception(name: "ERR_UNAVAILABLE", description: "El modelo de Apple Intelligence no está disponible en este dispositivo.")
    }

    AsyncFunction("liftSubject") { (uri: String) async throws -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        throw Exception(name: "ERR_UNAVAILABLE", description: "Recortar en el dispositivo necesita iOS 17.")
      }
      return try SubjectLifter.lift(url: try fileURL(uri))
    }
  }
}

private func fileURL(_ uri: String) throws -> URL {
  if let url = URL(string: uri), url.isFileURL { return url }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  throw Exception(name: "ERR_BAD_URI", description: "Solo se pueden analizar imágenes guardadas en el dispositivo.")
}

// MARK: - Vision subject lifting

@available(iOS 17.0, *)
enum SubjectLifter {
  private static let context = CIContext()

  /// Cuts the salient subject(s) out of the photo and writes a transparent PNG to the caches folder.
  static func lift(url: URL) throws -> [String: Any] {
    guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else {
      throw Exception(name: "ERR_IMAGE", description: "No se ha podido leer la imagen.")
    }
    let handler = VNImageRequestHandler(ciImage: image)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      throw Exception(name: "ERR_NO_SUBJECT", description: "No se distingue ningún objeto en la foto.")
    }
    let buffer = try observation.generateMaskedImage(ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: true)
    let cut = CIImage(cvPixelBuffer: buffer)
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("dressit-lift", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let out = dir.appendingPathComponent("\(UUID().uuidString).png")
    guard let srgb = CGColorSpace(name: CGColorSpace.sRGB) else { throw Exception(name: "ERR_IMAGE", description: "Espacio de color no disponible.") }
    try context.writePNGRepresentation(of: cut, to: out, format: .RGBA8, colorSpace: srgb)
    return ["uri": out.absoluteString, "width": Int(cut.extent.width), "height": Int(cut.extent.height)]
  }
}

// MARK: - Foundation Models

#if canImport(FoundationModels)
@available(iOS 26.0, *)
@Generable
struct AssistantReading {
  @Guide(description: "Qué pide: outfit (qué ponerse), trip (viaje o maleta), shopping (buscar o comprar un producto), gaps (qué le falta en el armario), weather (solo el tiempo), count (cuántas prendas tiene), other", .anyOf(["outfit", "trip", "shopping", "gaps", "weather", "count", "other"]))
  var kind: String
  @Guide(description: "Cuándo", .anyOf(["hoy", "manana", "pasado_manana", "dia_semana", "fecha", "sin_fecha"]))
  var when: String
  @Guide(description: "Día de la semana si when es dia_semana", .anyOf(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo", "ninguno"]))
  var weekday: String
  @Guide(description: "Día del mes si when es fecha; si no, 0", .range(0...31))
  var dayOfMonth: Int
  @Guide(description: "Ocasión (identificador de la lista) o ninguna")
  var occasion: String
  @Guide(description: "Formalidad pedida: -1 más informal, 0 normal, 1 más formal", .range(-1...1))
  var formality: Int
  @Guide(description: "Abrigo pedido: -1 más fresco, 0 normal, 1 más abrigado", .range(-1...1))
  var warmth: Int
  @Guide(description: "Ciudad de destino del viaje tal como está escrita, o vacío")
  var destination: String
  @Guide(description: "Número de días del viaje; 0 si no se dice", .range(0...30))
  var days: Int
  @Guide(description: "Tipo de prenda mencionado (identificador de la lista) o ninguna")
  var subcategory: String
  @Guide(description: "Color mencionado, en español, o vacío")
  var color: String
  @Guide(description: "Precio máximo en euros; 0 si no se dice", .range(0...5000))
  var maxPrice: Int
  @Guide(description: "Prenda concreta del usuario que quiere incluir, copiada del texto (p. ej. «mis pantalones negros»), o vacío")
  var garmentPhrase: String
  @Guide(description: "Tipos de prenda que NO quiere llevar (identificadores de la lista)")
  var exclude: [String]
}

@available(iOS 26.0, *)
@Generable
struct GarmentDescription {
  @Guide(description: "Nombre corto y natural en español para un armario, de 2 a 5 palabras, sin marca")
  var name: String
  @Guide(description: "Una frase que describe la prenda: tejido, corte y detalles visibles. Sin marcas ni suposiciones.")
  var summary: String
}

@available(iOS 26.0, *)
enum OnDeviceLanguage {
  static let modelId = "apple-foundation-models"

  private static func requireModel() throws -> SystemLanguageModel {
    let model = SystemLanguageModel.default
    guard model.isAvailable else {
      throw Exception(name: "ERR_UNAVAILABLE", description: "Apple Intelligence no está disponible o no está activado.")
    }
    return model
  }

  static func extractIntent(text: String, occasions: [String], subcategories: [String], today: String) async throws -> [String: Any] {
    let model = try requireModel()
    let session = LanguageModelSession(model: model, instructions: """
    Conviertes peticiones en español de una app de armario en datos estructurados. No respondes al usuario. \
    Hoy es \(today). Ocasiones válidas: \(occasions.joined(separator: ", ")). \
    Tipos de prenda válidos: \(subcategories.joined(separator: ", ")). \
    Usa solo identificadores de esas listas; si no encaja ninguno, escribe ninguna. No inventes datos que no estén en el texto.
    """)
    let reading = try await session.respond(to: text, generating: AssistantReading.self, options: GenerationOptions(sampling: .greedy)).content
    func clean(_ s: String) -> Any { let v = s.trimmingCharacters(in: .whitespacesAndNewlines); return v.isEmpty || v == "ninguna" || v == "ninguno" ? NSNull() : v }
    return [
      "kind": reading.kind,
      "when": reading.when,
      "weekday": clean(reading.weekday),
      "dayOfMonth": reading.dayOfMonth > 0 ? reading.dayOfMonth : NSNull(),
      "occasion": clean(reading.occasion),
      "formality": reading.formality,
      "warmth": reading.warmth,
      "destination": clean(reading.destination),
      "days": reading.days > 0 ? reading.days : NSNull(),
      "subcategory": clean(reading.subcategory),
      "color": clean(reading.color),
      "maxPrice": reading.maxPrice > 0 ? reading.maxPrice : NSNull(),
      "garmentPhrase": clean(reading.garmentPhrase),
      "exclude": reading.exclude.filter { subcategories.contains($0) },
      "model": modelId,
    ]
  }

  static func summarize(facts: String, style: String) async throws -> String {
    let model = try requireModel()
    let session = LanguageModelSession(model: model, instructions: """
    Escribes textos breves en español para una app de armario. Usa solo los datos que te dan: no inventes cifras, \
    prendas, marcas, tiendas ni circunstancias personales. Tono cercano y concreto. \(style)
    """)
    return try await session.respond(to: facts).content.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  @available(iOS 27.0, *)
  static func describeGarment(url: URL, typeLabel: String?) async throws -> [String: Any] {
    let model = try requireModel()
    guard model.capabilities.contains(.vision) else {
      throw Exception(name: "ERR_UNAVAILABLE", description: "Este modelo no acepta imágenes.")
    }
    let session = LanguageModelSession(model: model, instructions: """
    Describes prendas de ropa a partir de una foto para el armario digital de su dueño. Describe solo lo que se ve. \
    Ignora perchas, maniquíes, personas y el fondo.
    """)
    let hint = typeLabel.map { "La prenda es: \($0)." } ?? ""
    let description = try await session.respond(generating: GarmentDescription.self, options: GenerationOptions(sampling: .greedy)) {
      "Describe la prenda principal de esta foto. \(hint)"
      Attachment(imageURL: url)
    }.content
    return ["name": description.name, "summary": description.summary, "model": modelId]
  }
}
#endif
