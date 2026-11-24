import Vision
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let ctx = CIContext()
var i = 0
for p in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: p)
  let handler = VNImageRequestHandler(url: url)
  let req = VNGenerateForegroundInstanceMaskRequest()
  let t0 = Date()
  do {
    try handler.perform([req])
    guard let obs = req.results?.first else { print("no subject", p); continue }
    let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: true)
    let ci = CIImage(cvPixelBuffer: buf)
    let out = URL(fileURLWithPath: "lift/\(i).png")
    try ctx.writePNGRepresentation(of: ci, to: out, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
    print(String(format: "%.2fs", Date().timeIntervalSince(t0)), i, obs.allInstances.count, "instances")
  } catch { print("ERR", error) }
  i += 1
}
