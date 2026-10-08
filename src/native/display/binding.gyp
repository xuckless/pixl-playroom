{
  "targets": [
    {
      "target_name": "display",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["display.mm"],
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fobjc-arc"],
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          },
          "link_settings": { "libraries": ["-framework AppKit"] }
        }]
      ]
    }
  ]
}
