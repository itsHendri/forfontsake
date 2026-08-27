import Foundation
import CoreText

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path) as CFURL
guard let descs = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor], !descs.isEmpty else {
    print("FAIL: CoreText could not create descriptors")
    exit(1)
}
for d in descs {
    let font = CTFontCreateWithFontDescriptor(d, 48, nil)
    let name = CTFontCopyFullName(font) as String
    let ps = CTFontCopyPostScriptName(font) as String
    let count = CTFontGetGlyphCount(font)
    let upm = CTFontGetUnitsPerEm(font)
    // shape a string to prove glyphs actually resolve
    let chars = Array("LisbonTag".utf16)
    var glyphs = [CGGlyph](repeating: 0, count: chars.count)
    let ok = CTFontGetGlyphsForCharacters(font, chars, &glyphs, chars.count)
    let missing = glyphs.filter { $0 == 0 }.count
    let bbox = CTFontGetBoundingRectsForGlyphs(font, .horizontal, glyphs, nil, glyphs.count)
    print("OK: \(name) / \(ps) — \(count) glyphs, upm \(upm), mapped=\(ok), missing=\(missing), bbox=\(Int(bbox.width))x\(Int(bbox.height))")
}
