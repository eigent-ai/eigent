// swift-tools-version:5.10
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import PackageDescription

let package = Package(
  name: "EigentAppleBridge",
  // The bridge must launch on macOS releases without Foundation Models and
  // report `unsupported_os`, so the deployment target stays below macOS 26
  // and the framework is weak-linked.
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "eigent-apple-bridge", targets: ["EigentAppleBridge"])
  ],
  targets: [
    // Request parsing, access checks, OpenAI mapping and routing. No Apple
    // model calls, so `swift test` runs on any Mac.
    .target(name: "AppleBridgeCore"),
    .executableTarget(
      name: "EigentAppleBridge",
      dependencies: ["AppleBridgeCore"],
      swiftSettings: [
        .unsafeFlags([
          "-Xfrontend", "-disable-autolink-framework",
          "-Xfrontend", "FoundationModels",
        ])
      ],
      linkerSettings: [
        .unsafeFlags(["-Xlinker", "-weak_framework", "-Xlinker", "FoundationModels"])
      ]
    ),
    .testTarget(name: "AppleBridgeCoreTests", dependencies: ["AppleBridgeCore"]),
  ]
)
