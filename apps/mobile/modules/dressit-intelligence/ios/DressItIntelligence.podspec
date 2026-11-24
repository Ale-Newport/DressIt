Pod::Spec.new do |s|
  s.name           = 'DressItIntelligence'
  s.version        = '0.1.0'
  s.summary        = 'On-device Apple Intelligence and Vision helpers for DressIt'
  s.description    = 'Foundation Models (intent reading, garment descriptions, summaries) and Vision subject lifting, all on device.'
  s.author         = 'DressIt'
  s.homepage       = 'https://github.com/Ale-Newport/DressIt'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.10'
  s.dependency 'ExpoModulesCore'
  # Newer than the deployment target: weak-linked and guarded with #available at runtime.
  s.weak_frameworks = 'FoundationModels'
  s.frameworks = 'Vision', 'CoreImage'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end
