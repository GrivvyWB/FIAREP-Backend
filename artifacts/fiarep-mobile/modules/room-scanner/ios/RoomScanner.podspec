Pod::Spec.new do |s|
  s.name           = 'RoomScanner'
  s.version        = '1.0.0'
  s.summary        = 'RoomPlan LiDAR room scanner'
  s.description    = 'Scans rooms with RoomPlan/LiDAR and returns dimensions and a 2D floor plan.'
  s.license        = 'MIT'
  s.author         = 'Grivvy Com LLC'
  s.homepage       = 'https://grivvy.com'
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
