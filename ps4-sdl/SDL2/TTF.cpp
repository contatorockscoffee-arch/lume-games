#include "TTF.h"

#include <stdio.h>
#include <string.h>

FT_Library ftLib;

bool InitFont(FT_Face* face, const char* fontPath, int fontSize)
{
    if (FT_New_Face(ftLib, fontPath, 0, face) < 0)
        return false;
    return FT_Set_Pixel_Sizes(*face, 0, fontSize) >= 0;
}

// The original sample encoded glyph coverage into an invalid colour-keyed
// surface. Lume uses regular RGBA glyph textures, which stay readable on TV.
int SetText(SDL_Surface* surface, char* txt, FT_Face face, Color fgColor, Color)
{
    if (!surface || !txt || !face) return 0;
    int penX = 0;
    const int baseline = face->size->metrics.y_ppem;
    for (const unsigned char* p = (const unsigned char*)txt; *p; ++p) {
        FT_UInt glyph = FT_Get_Char_Index(face, *p);
        if (FT_Load_Glyph(face, glyph, FT_LOAD_DEFAULT) ||
            FT_Render_Glyph(face->glyph, ft_render_mode_normal)) continue;
        FT_GlyphSlot slot = face->glyph;
        for (int y = 0; y < (int)slot->bitmap.rows; ++y) {
            for (int x = 0; x < (int)slot->bitmap.width; ++x) {
                const int dstX = penX + x + (slot->metrics.horiBearingX >> 6);
                const int dstY = baseline + y - slot->bitmap_top;
                if (dstX < 0 || dstY < 0 || dstX >= surface->w || dstY >= surface->h) continue;
                const Uint8 coverage = slot->bitmap.buffer[y * slot->bitmap.pitch + x];
                if (!coverage) continue;
                Uint32 pixel = SDL_MapRGBA(surface->format, fgColor.r, fgColor.g, fgColor.b, coverage);
                ((Uint32*)surface->pixels)[dstY * (surface->pitch / 4) + dstX] = pixel;
            }
        }
        penX += slot->advance.x >> 6;
    }
    return penX;
}

SDL_Texture* CreateText(SDL_Renderer* renderer, char* txt, FT_Face fontFace, Color fgColor, Color bgColor)
{
    if (!renderer || !txt || !fontFace) return nullptr;
    const int fontHeight = fontFace->size->metrics.y_ppem;
    const int width = strlen(txt) * (fontFace->size->metrics.x_ppem + 2) + 8;
    const int height = fontHeight * 2 + 8;
#if SDL_BYTEORDER == SDL_BIG_ENDIAN
    const Uint32 rmask = 0xff000000, gmask = 0x00ff0000, bmask = 0x0000ff00, amask = 0x000000ff;
#else
    const Uint32 rmask = 0x000000ff, gmask = 0x0000ff00, bmask = 0x00ff0000, amask = 0xff000000;
#endif
    SDL_Surface* surface = SDL_CreateRGBSurface(0, width, height, 32, rmask, gmask, bmask, amask);
    if (!surface) return nullptr;
    SDL_FillRect(surface, nullptr, SDL_MapRGBA(surface->format, bgColor.r, bgColor.g, bgColor.b, 0));
    SetText(surface, txt, fontFace, fgColor, bgColor);
    SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer, surface);
    if (texture) SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
    SDL_FreeSurface(surface);
    return texture;
}

