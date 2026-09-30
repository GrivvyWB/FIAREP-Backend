import ExpoModulesCore
import ARKit
import SceneKit
import UIKit

class ARMeasureDelegate: NSObject, ARSCNViewDelegate {
  private let promise: Promise
  private var vc: UIViewController?
  private var sceneView: ARSCNView?
  private var points: [SCNVector3] = []
  private var nodes: [SCNNode] = []
  private var lineNodes: [SCNNode] = []
  private var infoLabel: UILabel?
  private var finished = false

  private let M_TO_FT = 3.28084
  // Guided mode: one prompt per corner (e.g. a door opening). Empty = free tapping.
  private var steps: [String] = []

  init(promise: Promise, steps: [String] = []) { self.promise = promise; self.steps = steps }

  private func prompt(for index: Int) -> String {
    if steps.isEmpty { return "Tap corners of the area. 2 points = length, 3+ = area." }
    if index < steps.count { return "Step \(index + 1) of \(steps.count): \(steps[index])" }
    return "All corners placed. Tap Done."
  }

  func present() {
    let controller = UIViewController()
    controller.modalPresentationStyle = .fullScreen

    let sv = ARSCNView(frame: UIScreen.main.bounds)
    sv.delegate = self
    sv.automaticallyUpdatesLighting = true
    let cfg = ARWorldTrackingConfiguration()
    cfg.planeDetection = [.horizontal, .vertical]
    sv.session.run(cfg)
    controller.view.addSubview(sv)
    self.sceneView = sv

    // tap to place a point
    let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
    sv.addGestureRecognizer(tap)

    // crosshair in center
    let cross = UILabel(frame: CGRect(x: 0, y: 0, width: 40, height: 40))
    cross.text = "+"
    cross.font = UIFont.systemFont(ofSize: 34, weight: .thin)
    cross.textColor = .white
    cross.textAlignment = .center
    cross.center = controller.view.center
    controller.view.addSubview(cross)

    // info label (measurements)
    let info = UILabel(frame: CGRect(x: 16, y: 60, width: UIScreen.main.bounds.width - 32, height: 130))
    info.numberOfLines = 0
    info.textColor = .white
    info.font = UIFont.boldSystemFont(ofSize: 17)
    info.text = prompt(for: 0)
    info.layer.shadowColor = UIColor.black.cgColor
    info.layer.shadowRadius = 3
    info.layer.shadowOpacity = 0.9
    info.layer.shadowOffset = .zero
    controller.view.addSubview(info)
    self.infoLabel = info

    // buttons
    let done = UIButton(type: .system)
    done.setTitle("Done", for: .normal)
    done.setTitleColor(.white, for: .normal)
    done.backgroundColor = UIColor(red: 0.09, green: 0.37, blue: 0.65, alpha: 1)
    done.titleLabel?.font = UIFont.boldSystemFont(ofSize: 17)
    done.layer.cornerRadius = 10
    done.frame = CGRect(x: UIScreen.main.bounds.width - 116, y: UIScreen.main.bounds.height - 90, width: 100, height: 48)
    done.addTarget(self, action: #selector(handleDone), for: .touchUpInside)
    controller.view.addSubview(done)

    let reset = UIButton(type: .system)
    reset.setTitle("Reset", for: .normal)
    reset.setTitleColor(.white, for: .normal)
    reset.backgroundColor = UIColor(white: 0.2, alpha: 0.85)
    reset.titleLabel?.font = UIFont.boldSystemFont(ofSize: 17)
    reset.layer.cornerRadius = 10
    reset.frame = CGRect(x: 16, y: UIScreen.main.bounds.height - 90, width: 100, height: 48)
    reset.addTarget(self, action: #selector(handleReset), for: .touchUpInside)
    controller.view.addSubview(reset)

    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.setTitleColor(.white, for: .normal)
    cancel.titleLabel?.font = UIFont.systemFont(ofSize: 16)
    cancel.frame = CGRect(x: UIScreen.main.bounds.width/2 - 50, y: UIScreen.main.bounds.height - 88, width: 100, height: 44)
    cancel.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
    controller.view.addSubview(cancel)

    self.vc = controller
    rootVC()?.present(controller, animated: true)
  }

  private func rootVC() -> UIViewController? {
    var root = UIApplication.shared.windows.first(where: { $0.isKeyWindow })?.rootViewController
    while let presented = root?.presentedViewController { root = presented }
    return root
  }

  @objc private func handleTap(_ g: UITapGestureRecognizer) {
    guard let sv = sceneView else { return }
    let center = CGPoint(x: sv.bounds.midX, y: sv.bounds.midY)
    // raycast from center crosshair onto any surface
    guard let query = sv.raycastQuery(from: center, allowing: .estimatedPlane, alignment: .any) else { return }
    let results = sv.session.raycast(query)
    guard let hit = results.first else { return }
    let pos = SCNVector3(hit.worldTransform.columns.3.x, hit.worldTransform.columns.3.y, hit.worldTransform.columns.3.z)
    points.append(pos)
    addSphere(at: pos)
    if points.count >= 2 { addLine(from: points[points.count - 2], to: pos) }
    updateInfo()
    if !steps.isEmpty && points.count >= steps.count {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.handleDone() }
    }
  }

  private func addSphere(at p: SCNVector3) {
    let s = SCNSphere(radius: 0.008)
    s.firstMaterial?.diffuse.contents = UIColor.systemYellow
    let n = SCNNode(geometry: s); n.position = p
    sceneView?.scene.rootNode.addChildNode(n); nodes.append(n)
  }

  private func addLine(from a: SCNVector3, to b: SCNVector3) {
    let n = lineNode(a, b); sceneView?.scene.rootNode.addChildNode(n); lineNodes.append(n)
  }

  private func lineNode(_ a: SCNVector3, _ b: SCNVector3) -> SCNNode {
    let v = SCNVector3(b.x - a.x, b.y - a.y, b.z - a.z)
    let dist = sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
    let cyl = SCNCylinder(radius: 0.003, height: CGFloat(dist))
    cyl.firstMaterial?.diffuse.contents = UIColor.systemYellow
    let node = SCNNode(geometry: cyl)
    node.position = SCNVector3((a.x+b.x)/2, (a.y+b.y)/2, (a.z+b.z)/2)
    node.look(at: b, up: sceneView!.scene.rootNode.worldUp, localFront: SCNVector3(0,1,0))
    return node
  }

  private func dist(_ a: SCNVector3, _ b: SCNVector3) -> Double {
    let dx = Double(b.x-a.x), dy = Double(b.y-a.y), dz = Double(b.z-a.z)
    return sqrt(dx*dx+dy*dy+dz*dz) * M_TO_FT
  }

  private func polygonAreaSqFt() -> Double {
    guard points.count >= 3 else { return 0 }
    // project to best-fit plane using first 3 points' normal, compute area via triangle fan
    var area = 0.0
    let o = points[0]
    for i in 1..<(points.count - 1) {
      let a = points[i], b = points[i+1]
      let v1 = SCNVector3(a.x-o.x, a.y-o.y, a.z-o.z)
      let v2 = SCNVector3(b.x-o.x, b.y-o.y, b.z-o.z)
      let cx = v1.y*v2.z - v1.z*v2.y
      let cy = v1.z*v2.x - v1.x*v2.z
      let cz = v1.x*v2.y - v1.y*v2.x
      area += Double(sqrt(cx*cx+cy*cy+cz*cz)) / 2.0
    }
    return area * M_TO_FT * M_TO_FT
  }

  private func updateInfo() {
    guard let info = infoLabel else { return }
    if points.count < 2 { info.text = steps.isEmpty ? "Point placed. Tap the next corner." : prompt(for: points.count); return }
    var lines: [String] = []
    if !steps.isEmpty { lines.append(prompt(for: points.count)) }
    for i in 1..<points.count {
      lines.append(String(format: "Side %d: %.2f ft", i, dist(points[i-1], points[i])))
    }
    if points.count >= 3 {
      lines.append(String(format: "Area: %.2f sq ft", polygonAreaSqFt()))
    }
    info.text = lines.joined(separator: "   ")
  }

  @objc private func handleReset() {
    points.removeAll()
    nodes.forEach { $0.removeFromParentNode() }; nodes.removeAll()
    lineNodes.forEach { $0.removeFromParentNode() }; lineNodes.removeAll()
    infoLabel?.text = steps.isEmpty ? "Reset. Tap corners of the area." : prompt(for: 0)
  }

  @objc private func handleDone() {
    guard !finished else { return }
    finished = true
    var dists: [Double] = []
    for i in 1..<max(points.count, 1) { dists.append(dist(points[i-1], points[i])) }
    let area = polygonAreaSqFt()
    // bounding width/height from distances (best-effort: first two sides)
    let widthFt = dists.count >= 1 ? dists[0] : 0
    let heightFt = dists.count >= 2 ? dists[1] : 0
    // capture a snapshot of the AR view (with the measurement outline) and save it
    var imagePath = ""
    if let sv = sceneView {
      let snap = sv.snapshot()
      if let data = snap.jpegData(compressionQuality: 0.6) {
        let dir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
        let photosDir = (dir as NSString).appendingPathComponent("photos")
        try? FileManager.default.createDirectory(atPath: photosDir, withIntermediateDirectories: true)
        let name = "armeasure_\(Int(Date().timeIntervalSince1970 * 1000)).jpg"
        let fullPath = (photosDir as NSString).appendingPathComponent(name)
        if (try? data.write(to: URL(fileURLWithPath: fullPath))) != nil {
          imagePath = "photos/\(name)"
        }
      }
    }
    let result: [String: Any] = [
      "points": points.map { ["x": Double($0.x), "y": Double($0.y), "z": Double($0.z)] },
      "distancesFt": dists.map { round($0 * 100) / 100 },
      "areaSqFt": round(area * 100) / 100,
      "widthFt": round(widthFt * 100) / 100,
      "heightFt": round(heightFt * 100) / 100,
      "imagePath": imagePath,
    ]
    sceneView?.session.pause()
    vc?.dismiss(animated: true) { [weak self] in self?.promise.resolve(result) }
  }

  @objc private func handleCancel() {
    guard !finished else { return }
    finished = true
    sceneView?.session.pause()
    vc?.dismiss(animated: true) { [weak self] in
      self?.promise.reject("CANCELLED", "Measurement cancelled.")
    }
  }
}
