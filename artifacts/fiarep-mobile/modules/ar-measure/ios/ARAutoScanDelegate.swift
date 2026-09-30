import ExpoModulesCore
import ARKit
import SceneKit
import UIKit
import Vision

// Automatic scan: no tapping. Vision finds the largest rectangle in view (a
// door or window frame, a concrete slab, a sidewalk flag, a driveway, a wall
// or facade), ARKit raycasts its four corners onto the real surface, and once
// the size holds steady for a moment the scan finishes with the real width
// and height. "opening" mode prefers tall rectangles on a wall; "surface"
// mode takes any rectangle on any surface. "Use this" accepts an unsteady
// reading; Cancel rejects.
class ARAutoScanDelegate: NSObject, ARSCNViewDelegate {
  private let promise: Promise
  private let mode: String   // "opening" | "surface" | "sweep"
  private let label: String  // what we are scanning, for the prompts
  private var vc: UIViewController?
  private var sceneView: ARSCNView?
  private var infoLabel: UILabel?
  private var useButton: UIButton?
  private var outline = CAShapeLayer()
  private var finished = false
  private var busy = false
  private var frameCount = 0
  private var readings: [(w: Double, h: Double)] = []
  private var last: (w: Double, h: Double, corners: [CGPoint])? = nil
  private let M_TO_FT = 3.28084
  private let queue = DispatchQueue(label: "ar.autoscan.vision")
  // Sweep mode: the surface under the crosshair grows as the camera pans over
  // it; we report the tracked plane's extent and lock when it stops growing.
  private var sweepAnchorId: UUID? = nil
  private var sweepLast: (w: Double, h: Double) = (0, 0)
  private var sweepStableSince: TimeInterval = 0
  private var sweepStarted: TimeInterval = 0
  private var planeNodes: [UUID: SCNNode] = [:]

  init(promise: Promise, mode: String = "opening", label: String = "opening") { self.promise = promise; self.mode = mode; self.label = label }

  func present() {
    let controller = UIViewController()
    controller.modalPresentationStyle = .fullScreen
    let sv = ARSCNView(frame: UIScreen.main.bounds)
    sv.delegate = self
    sv.automaticallyUpdatesLighting = true
    let cfg = ARWorldTrackingConfiguration()
    cfg.planeDetection = [.vertical, .horizontal]
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) { cfg.sceneReconstruction = .mesh }
    sv.session.run(cfg)
    controller.view.addSubview(sv)
    self.sceneView = sv

    outline.strokeColor = UIColor.systemYellow.cgColor
    outline.fillColor = UIColor.systemYellow.withAlphaComponent(0.12).cgColor
    outline.lineWidth = 3
    sv.layer.addSublayer(outline)

    let info = UILabel(frame: CGRect(x: 16, y: 60, width: UIScreen.main.bounds.width - 32, height: 130))
    info.numberOfLines = 0
    info.textColor = .white
    info.font = UIFont.boldSystemFont(ofSize: 17)
    info.text = mode == "sweep"
      ? "Point at the \(label) and slowly sweep the camera across ALL of it, edge to edge. The yellow patch shows what has been measured so far."
      : "Stand back so the WHOLE \(label) is in view, edge to edge. Hold the phone still — it measures by itself."
    info.layer.shadowColor = UIColor.black.cgColor
    info.layer.shadowRadius = 3
    info.layer.shadowOpacity = 0.9
    info.layer.shadowOffset = .zero
    controller.view.addSubview(info)
    self.infoLabel = info

    let use = UIButton(type: .system)
    use.setTitle("Use this", for: .normal)
    use.setTitleColor(.white, for: .normal)
    use.backgroundColor = UIColor(red: 0.09, green: 0.37, blue: 0.65, alpha: 1)
    use.titleLabel?.font = UIFont.boldSystemFont(ofSize: 17)
    use.layer.cornerRadius = 10
    use.frame = CGRect(x: UIScreen.main.bounds.width - 136, y: UIScreen.main.bounds.height - 90, width: 120, height: 48)
    use.addTarget(self, action: #selector(handleUse), for: .touchUpInside)
    use.isEnabled = false
    use.alpha = 0.5
    controller.view.addSubview(use)
    self.useButton = use

    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.setTitleColor(.white, for: .normal)
    cancel.titleLabel?.font = UIFont.systemFont(ofSize: 16)
    cancel.frame = CGRect(x: 16, y: UIScreen.main.bounds.height - 88, width: 100, height: 44)
    cancel.addTarget(self, action: #selector(handleCancel), for: .touchUpInside)
    controller.view.addSubview(cancel)

    self.vc = controller
    rootVC()?.present(controller, animated: true)
  }

  private func rootVC() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
    var top = window?.rootViewController
    while let p = top?.presentedViewController { top = p }
    return top
  }

  // Sweep mode: show each detected surface as a translucent patch so the
  // user sees what has been covered.
  func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
    guard mode == "sweep", let plane = anchor as? ARPlaneAnchor, let sv = sceneView, let dev = sv.device else { return }
    let geo = ARSCNPlaneGeometry(device: dev)
    geo?.update(from: plane.geometry)
    geo?.firstMaterial?.diffuse.contents = UIColor.systemYellow.withAlphaComponent(0.25)
    let n = SCNNode(geometry: geo)
    node.addChildNode(n)
    planeNodes[plane.identifier] = n
  }
  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    guard mode == "sweep", let plane = anchor as? ARPlaneAnchor, let n = planeNodes[plane.identifier],
          let geo = n.geometry as? ARSCNPlaneGeometry else { return }
    geo.update(from: plane.geometry)
    n.geometry?.firstMaterial?.diffuse.contents = plane.identifier == sweepAnchorId
      ? UIColor.systemYellow.withAlphaComponent(0.35) : UIColor.white.withAlphaComponent(0.12)
  }

  private func sweepTick(_ time: TimeInterval) {
    guard let sv = sceneView, let frame = sv.session.currentFrame else { return }
    if sweepStarted == 0 { sweepStarted = time }
    let center = CGPoint(x: sv.bounds.midX, y: sv.bounds.midY)
    guard let q = sv.raycastQuery(from: center, allowing: .existingPlaneGeometry, alignment: .any),
          let hit = sv.session.raycast(q).first, let plane = hit.anchor as? ARPlaneAnchor else {
      if sweepAnchorId == nil { infoLabel?.text = "Finding the \(label)… move the camera slowly over it." }
      return
    }
    // Follow the plane under the crosshair; if the user pans to a bigger one, take that.
    if sweepAnchorId != plane.identifier { sweepAnchorId = plane.identifier; sweepStableSince = 0 }
    let anchors = frame.anchors.compactMap { $0 as? ARPlaneAnchor }
    guard let tracked = anchors.first(where: { $0.identifier == sweepAnchorId }) else { return }
    let w = Double(tracked.planeExtent.width) * M_TO_FT
    let h = Double(tracked.planeExtent.height) * M_TO_FT
    let grew = abs(w - sweepLast.w) / max(w, 0.01) > 0.01 || abs(h - sweepLast.h) / max(h, 0.01) > 0.01
    if grew || sweepStableSince == 0 { sweepStableSince = time }
    sweepLast = (w, h)
    last = (w, h, [])
    useButton?.isEnabled = true; useButton?.alpha = 1
    let title = label.prefix(1).uppercased() + label.dropFirst()
    let held = time - sweepStableSince
    let locked = held > 3.0 && time - sweepStarted > 4.0 && w > 0.5 && h > 0.5
    infoLabel?.text = String(format: "%@ so far: %.2f × %.2f ft = %.1f sq ft\n%@", String(title), w, h, w * h,
      locked ? "Locked in." : "Keep sweeping to the edges… tap Use this when it covers the whole \(label).")
    if locked { finish(w: w, h: h) }
  }

  // Every few frames: find the opening in the camera image and measure it.
  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    frameCount += 1
    if mode == "sweep" {
      if frameCount % 6 == 0 && !finished { DispatchQueue.main.async { [weak self] in self?.sweepTick(time) } }
      return
    }
    guard !finished, !busy, frameCount % 5 == 0, let sv = sceneView, let frame = sv.session.currentFrame else { return }
    busy = true
    let pixelBuffer = frame.capturedImage
    let viewSize = sv.bounds.size
    let transform = frame.displayTransform(for: .portrait, viewportSize: viewSize)
    queue.async { [weak self] in
      guard let self = self else { return }
      let request = VNDetectRectanglesRequest()
      request.minimumAspectRatio = self.mode == "opening" ? 0.25 : 0.08   // shorter ÷ longer side
      request.maximumAspectRatio = 1.0
      request.minimumSize = self.mode == "opening" ? 0.2 : 0.15
      request.minimumConfidence = 0.5
      request.quadratureTolerance = 25
      request.maximumObservations = 6
      let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
      var best: VNRectangleObservation? = nil
      do {
        try handler.perform([request])
        // The largest rectangle that is taller than it is wide on screen.
        for r in (request.results ?? []) {
          let w = r.boundingBox.width, h = r.boundingBox.height
          // Sensor image is landscape; a portrait door appears wider than tall there.
          let tallOnScreen = w > h
          if self.mode == "opening" && !tallOnScreen { continue }
          if best == nil || (w * h) > (best!.boundingBox.width * best!.boundingBox.height) { best = r }
        }
      } catch { }
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        defer { self.busy = false }
        guard !self.finished else { return }
        guard let rect = best else { self.noReading(); return }
        // Vision: normalized, origin bottom-left in the (landscape) image → image
        // coords origin top-left → view coordinates.
        let toView: (CGPoint) -> CGPoint = { p in
          let img = CGPoint(x: p.x, y: 1 - p.y)
          let n = img.applying(transform)
          return CGPoint(x: n.x * viewSize.width, y: n.y * viewSize.height)
        }
        let cornersImg = [rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft]
        let cornersView = cornersImg.map(toView)
        // Sort into screen order: top-left, top-right, bottom-right, bottom-left.
        let byY = cornersView.sorted { $0.y < $1.y }
        let top = Array(byY[0..<2]).sorted { $0.x < $1.x }
        let bottom = Array(byY[2..<4]).sorted { $0.x < $1.x }
        let ordered = [top[0], top[1], bottom[1], bottom[0]]
        var world: [SCNVector3] = []
        for p in ordered {
          guard let q = sv.raycastQuery(from: p, allowing: .estimatedPlane, alignment: .any),
                let hit = sv.session.raycast(q).first else { self.noReading(); return }
          let c = hit.worldTransform.columns.3
          world.append(SCNVector3(c.x, c.y, c.z))
        }
        let widthM = (self.dist(world[0], world[1]) + self.dist(world[3], world[2])) / 2
        let heightM = (self.dist(world[0], world[3]) + self.dist(world[1], world[2])) / 2
        let maxM = self.mode == "opening" ? 4.0 : 120.0
        guard widthM > 0.2, heightM > 0.2, widthM < maxM, heightM < maxM else { self.noReading(); return }
        let w = widthM * self.M_TO_FT, h = heightM * self.M_TO_FT
        self.last = (w, h, ordered)
        self.readings.append((w, h)); if self.readings.count > 8 { self.readings.removeFirst() }
        self.draw(ordered)
        let wIn = (w * 12 * 4).rounded() / 4, hIn = (h * 12 * 4).rounded() / 4
        let steady = self.isSteady()
        let title = self.label.prefix(1).uppercased() + self.label.dropFirst()
        self.infoLabel?.text = String(format: "%@: %.2f\" × %.2f\" (%.2f × %.2f ft = %.1f sq ft)\n%@", String(title), wIn, hIn, w, h, w * h, steady ? "Locked in." : "Hold still… locking in the size.")
        self.useButton?.isEnabled = true; self.useButton?.alpha = 1
        if steady { self.finish(w: w, h: h) }
      }
    }
  }

  private func noReading() {
    outline.path = nil
    if last == nil { infoLabel?.text = "Looking for the \(label)… keep its whole outline in view and hold still." }
  }

  private func isSteady() -> Bool {
    guard readings.count >= 6 else { return false }
    let ws = readings.map { $0.w }, hs = readings.map { $0.h }
    guard let wMin = ws.min(), let wMax = ws.max(), let hMin = hs.min(), let hMax = hs.max() else { return false }
    return (wMax - wMin) / wMax < 0.03 && (hMax - hMin) / hMax < 0.03
  }

  private func draw(_ pts: [CGPoint]) {
    let path = UIBezierPath()
    path.move(to: pts[0]); for p in pts.dropFirst() { path.addLine(to: p) }; path.close()
    outline.path = path.cgPath
  }

  private func dist(_ a: SCNVector3, _ b: SCNVector3) -> Double {
    let dx = Double(b.x-a.x), dy = Double(b.y-a.y), dz = Double(b.z-a.z)
    return sqrt(dx*dx+dy*dy+dz*dz)
  }

  @objc private func handleUse() {
    guard let l = last else { return }
    if mode == "sweep" { finish(w: l.w, h: l.h); return }
    // Average the recent readings so one shaky frame doesn't decide it.
    let ws = readings.map { $0.w }, hs = readings.map { $0.h }
    let w = ws.isEmpty ? l.w : ws.reduce(0, +) / Double(ws.count)
    let h = hs.isEmpty ? l.h : hs.reduce(0, +) / Double(hs.count)
    finish(w: w, h: h)
  }

  private func finish(w: Double, h: Double) {
    guard !finished else { return }
    finished = true
    let result: [String: Any] = [
      "points": [],
      "distancesFt": [(w * 100).rounded() / 100, (h * 100).rounded() / 100],
      "areaSqFt": (w * h * 100).rounded() / 100,
      "widthFt": (w * 100).rounded() / 100,
      "heightFt": (h * 100).rounded() / 100,
      "imagePath": "",
      "auto": true,
    ]
    sceneView?.session.pause()
    vc?.dismiss(animated: true) { [weak self] in self?.promise.resolve(result) }
  }

  @objc private func handleCancel() {
    guard !finished else { return }
    finished = true
    sceneView?.session.pause()
    vc?.dismiss(animated: true) { [weak self] in self?.promise.reject("CANCELLED", "Scan cancelled") }
  }
}
