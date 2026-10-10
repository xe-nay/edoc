Pod::Spec.new do |s|
  s.name           = 'EdocKit'
  s.version        = '1.0.0'
  s.summary        = 'Scanner, OCR and PDF helpers for eDoc'
  s.description    = 'VisionKit document scanning, Vision text recognition and PDF import/export for eDoc'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'VisionKit', 'Vision', 'PDFKit', 'CoreImage', 'CryptoKit', 'Security'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
