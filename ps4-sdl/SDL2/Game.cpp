#include <vector>
#include <string>
#include <algorithm>

#include "Game.h"

// Lume's first SDL screen intentionally has no dependency on web content.  It
// is a reliable shell for TV testing; the catalog transport is added on top of
// this renderer instead of mixing network work into the draw loop.
FT_Face fontDebug;
FT_Face fontScore;
Color bgColor = { 5, 13, 31 };
Color fgColor = { 239, 247, 255 };
SDL_Joystick* controller = nullptr;

namespace {
constexpr int W = 1920;
constexpr int H = 1080;

struct UiText { SDL_Texture* texture; int x; int y; int w; int h; };
struct Card { const char* title; const char* size; const char* platform; Color top; Color bottom; };

std::vector<UiText> labels;
int selectedCard = 0;
int selectedNav = 1;
int selectedFilter = 0;
bool lightTheme = false;
bool detailsOpen = false;
bool queued = false;
float progress = 0.52f;
SDL_Texture* orbitalCover = nullptr;

const Card cards[] = {
    { "ORBITAL RIFT", "1.6 GB", "PS4", { 18, 93, 185 }, { 10, 28, 78 } },
    { "PIXEL HARBOR", "512 MB", "PS4", { 249, 143, 74 }, { 100, 35, 115 } },
    { "NEON TRAILS", "2.9 GB", "PS4", { 198, 40, 186 }, { 25, 59, 157 } },
    { "TERRA FORGE", "1.8 GB", "HOMEBREW", { 39, 169, 211 }, { 15, 83, 122 } },
    { "METAL HORIZON", "3.4 GB", "PS2", { 207, 75, 57 }, { 68, 22, 45 } },
    { "VOID GARDEN", "1.2 GB", "PS4", { 21, 101, 124 }, { 12, 34, 70 } },
};

Color cyan() { return { 40, 231, 240 }; }
Color pink() { return { 241, 66, 196 }; }
Color muted() { return lightTheme ? Color{ 69, 84, 111 } : Color{ 149, 169, 199 }; }
Color panel() { return lightTheme ? Color{ 241, 247, 255 } : Color{ 12, 27, 53 }; }
Color background() { return lightTheme ? Color{ 226, 237, 250 } : Color{ 5, 13, 31 }; }
Color ink() { return lightTheme ? Color{ 20, 33, 55 } : Color{ 239, 247, 255 }; }

void setColor(SDL_Renderer* r, Color c, Uint8 a = 255) { SDL_SetRenderDrawColor(r, c.r, c.g, c.b, a); }
void fill(SDL_Renderer* r, int x, int y, int w, int h, Color c, Uint8 a = 255) {
    SDL_Rect rect = { x, y, w, h }; setColor(r, c, a); SDL_RenderFillRect(r, &rect);
}
void stroke(SDL_Renderer* r, int x, int y, int w, int h, Color c, int t = 2) {
    setColor(r, c); for (int i = 0; i < t; ++i) { SDL_Rect rect = { x + i, y + i, w - i * 2, h - i * 2 }; SDL_RenderDrawRect(r, &rect); }
}

void addLabel(SDL_Renderer* r, const char* text, int x, int y, int px, Color color) {
    FT_Set_Pixel_Sizes(fontScore, 0, px);
    SDL_Texture* texture = CreateText(r, (char*)text, fontScore, color, background());
    if (!texture) return;
    int w = 0, h = 0; SDL_QueryTexture(texture, nullptr, nullptr, &w, &h);
    labels.push_back({ texture, x, y, w, h });
}

void drawText(SDL_Renderer* r, const UiText& text) {
    SDL_Rect target = { text.x, text.y, text.w, text.h };
    SDL_RenderCopy(r, text.texture, nullptr, &target);
}
void drawAllLabels(SDL_Renderer* r) { for (const UiText& text : labels) drawText(r, text); }

void initLabels(SDL_Renderer* r) {
    for (UiText& t : labels) if (t.texture) SDL_DestroyTexture(t.texture);
    labels.clear();
    const Color primary = ink(); const Color secondary = muted(); const Color accent = cyan();
    addLabel(r, "L", 76, 35, 44, accent);
    addLabel(r, "LUME GAMES", 138, 41, 29, primary);
    addLabel(r, "INICIO", 520, 42, 24, primary);
    addLabel(r, "JOGOS", 692, 42, 24, primary);
    addLabel(r, "DOWNLOADS", 842, 42, 24, primary);
    addLabel(r, "CONFIGURACOES", 1089, 42, 24, primary);
    addLabel(r, "CATALOGO  PS4", 76, 151, 20, accent);
    addLabel(r, "Sua biblioteca", 76, 191, 58, primary);
    addLabel(r, "Jogos autorizados e homebrew", 80, 267, 24, secondary);
    addLabel(r, "Todos", 99, 324, 22, lightTheme ? Color{ 4, 24, 34 } : Color{ 2, 28, 39 });
    addLabel(r, "PS4", 205, 324, 22, primary);
    addLabel(r, "PS2", 309, 324, 22, primary);
    addLabel(r, "Homebrew", 410, 324, 22, primary);
    addLabel(r, "Buscar jogos", 1088, 324, 20, secondary);
    addLabel(r, "FILA DE DOWNLOADS", 1494, 181, 26, primary);
    addLabel(r, "Terra Forge", 1575, 257, 22, primary);
    addLabel(r, "Baixando", 1575, 286, 18, accent);
    addLabel(r, "52%", 1785, 257, 25, primary);
    addLabel(r, "8.4 MB/s", 1517, 355, 18, primary);
    addLabel(r, "12 min restantes", 1688, 355, 18, primary);
    const int cardX = 76, cardY = 438, cardW = 204, gap = 22;
    for (int i = 0; i < 6; ++i) {
        int x = cardX + i * (cardW + gap);
        addLabel(r, cards[i].title, x + 16, 728, 22, primary);
        addLabel(r, cards[i].size, x + 16, 764, 19, secondary);
        addLabel(r, cards[i].platform, x + 139, 764, 16, i == 3 ? pink() : cyan());
    }
    addLabel(r, "X  Selecionar", 80, 1005, 20, primary);
    addLabel(r, "O  Voltar", 325, 1005, 20, primary);
    addLabel(r, "[]  Detalhes", 525, 1005, 20, primary);
    addLabel(r, "TRI  Tema", 760, 1005, 20, primary);
    addLabel(r, "L1/R1  Filtros", 985, 1005, 20, primary);
}

void gradientCard(SDL_Renderer* r, const SDL_Rect& rect, Color a, Color b) {
    for (int row = 0; row < rect.h; row += 4) {
        const float p = (float)row / (float)rect.h;
        Color c = { (Uint8)(a.r + (b.r - a.r) * p), (Uint8)(a.g + (b.g - a.g) * p), (Uint8)(a.b + (b.b - a.b) * p) };
        fill(r, rect.x, rect.y + row, rect.w, 4, c);
    }
    // Geometric texture brings depth without pretending to be a remote cover.
    setColor(r, { 255, 255, 255 }, 32);
    for (int i = -rect.h; i < rect.w; i += 38)
        SDL_RenderDrawLine(r, rect.x + i, rect.y + rect.h, rect.x + i + rect.h, rect.y);
}

void renderCover(SDL_Renderer* r, int index, int x, int y) {
    const int cw = 204, ch = 348, artH = 260;
    const Card& card = cards[index];
    fill(r, x, y, cw, ch, panel());
    SDL_Rect art = { x, y, cw, artH };
    if (index == 0 && orbitalCover) {
        // This is an original bundled cover. Remote catalog cover URLs will
        // replace it once the online media cache is connected.
        SDL_RenderCopy(r, orbitalCover, nullptr, &art);
    } else {
        gradientCard(r, art, card.top, card.bottom);
        // stylised retro focal element
        setColor(r, { 255, 255, 255 }, 36);
        SDL_Rect sun = { x + 58, y + 58, 92, 92 }; SDL_RenderFillRect(r, &sun);
        fill(r, x + 18, y + 190, 168, 4, cyan(), 190);
        fill(r, x + 32, y + 207, 140, 3, pink(), 155);
    }
    fill(r, x, y + artH, cw, ch - artH, panel());
    if (index == selectedCard) {
        stroke(r, x - 5, y - 5, cw + 10, ch + 10, cyan(), 4);
        stroke(r, x - 10, y - 10, cw + 20, ch + 20, cyan(), 1);
    }
    stroke(r, x + 133, y + 302, 55, 29, index == 3 ? pink() : cyan(), 2);
}

void renderBackground(SDL_Renderer* r) {
    const Color bg = background();
    fill(r, 0, 0, W, H, bg);
    // top bloom + low contrast grid
    for (int i = 0; i < 500; i += 12) {
        const Uint8 alpha = (Uint8)std::max(0, 35 - i / 18);
        fill(r, 880 - i, 0, 560 + i * 2, 12, { 43, 27, 104 }, alpha);
    }
    setColor(r, lightTheme ? Color{ 159, 181, 214 } : Color{ 33, 66, 113 }, 38);
    for (int x = 0; x < W; x += 42) SDL_RenderDrawLine(r, x, 100, x, 960);
    for (int y = 100; y < 960; y += 42) SDL_RenderDrawLine(r, 0, y, W, y);
}

void renderDetails(SDL_Renderer* r) {
    setColor(r, { 0, 0, 0 }, 160); SDL_Rect veil = { 0, 0, W, H }; SDL_RenderFillRect(r, &veil);
    fill(r, 535, 258, 850, 565, panel()); stroke(r, 535, 258, 850, 565, cyan(), 3);
    FT_Set_Pixel_Sizes(fontScore, 0, 36);
    SDL_Texture* headline = CreateText(r, (char*)cards[selectedCard].title, fontScore, ink(), background());
    SDL_Texture* copy = CreateText(r, (char*)"Pacote autorizado  Detalhes locais", fontScore, muted(), background());
    SDL_Texture* action = CreateText(r, (char*)(queued ? "NA FILA DE DOWNLOAD" : "X  ADICIONAR A FILA"), fontScore, cyan(), background());
    SDL_Texture* back = CreateText(r, (char*)"O  VOLTAR", fontScore, ink(), background());
    SDL_Texture* items[] = { headline, copy, action, back };
    int yy[] = { 320, 392, 692, 748 };
    for (int i = 0; i < 4; ++i) if (items[i]) { int tw, th; SDL_QueryTexture(items[i], 0, 0, &tw, &th); SDL_Rect dst = { 600, yy[i], tw, th }; SDL_RenderCopy(r, items[i], 0, &dst); SDL_DestroyTexture(items[i]); }
    fill(r, 600, 505, 720, 10, cyan()); fill(r, 600, 541, 585, 10, pink());
}
} // namespace

void initGame(SDL_Renderer* renderer) {
    IMG_Init(IMG_INIT_PNG);
    SDL_Surface* cover = IMG_Load("/app0/assets/images/orbital-rift.png");
    if (cover) {
        orbitalCover = SDL_CreateTextureFromSurface(renderer, cover);
        SDL_FreeSurface(cover);
    }
    initLabels(renderer);
}

void render(SDL_Renderer* renderer) {
    renderBackground(renderer);
    fill(renderer, 0, 0, W, 101, lightTheme ? Color{ 250, 253, 255 } : Color{ 7, 18, 41 });
    fill(renderer, 0, 99, W, 2, cyan());
    fill(renderer, 76, 30, 49, 49, { 67, 25, 134 }); stroke(renderer, 76, 30, 49, 49, pink(), 3);
    // active navigation + category chips
    const int navX[] = { 520, 692, 842, 1089 }; const int navW[] = { 84, 74, 154, 205 };
    fill(renderer, navX[selectedNav], 82, navW[selectedNav], 5, cyan());
    const int chipX[] = { 76, 183, 287, 388 }; const int chipW[] = { 83, 82, 78, 176 };
    for (int i = 0; i < 4; ++i) {
        if (i == selectedFilter) fill(renderer, chipX[i], 313, chipW[i], 50, cyan());
        else stroke(renderer, chipX[i], 313, chipW[i], 50, muted(), 2);
    }
    stroke(renderer, 1034, 313, 355, 50, muted(), 2);
    // Queue panel
    fill(renderer, 1460, 153, 385, 664, panel()); stroke(renderer, 1460, 153, 385, 664, pink(), 2);
    fill(renderer, 1490, 233, 60, 73, { 37, 142, 180 });
    fill(renderer, 1490, 319, 313, 12, { 28, 42, 71 });
    fill(renderer, 1490, 319, (int)(313 * progress), 12, cyan());
    fill(renderer, 1490, 331, (int)(313 * progress * .94f), 5, pink());
    // cards
    for (int i = 0; i < 6; ++i) renderCover(renderer, i, 76 + i * 226, 438);
    fill(renderer, 0, 961, W, 119, lightTheme ? Color{ 245, 249, 255 } : Color{ 5, 12, 28 });
    fill(renderer, 0, 960, W, 2, cyan());
    drawAllLabels(renderer);
    if (detailsOpen) renderDetails(renderer);
}

void update(SDL_Renderer* renderer, int deltaFrameTicks, int, int) {
    if (queued && progress < 0.99f) progress += deltaFrameTicks * 0.0000025f;
    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
        if (ev.type != SDL_JOYBUTTONDOWN) continue;
        const Uint8 b = ev.jbutton.button;
        if (b == PAD_BUTTON_TRIANGLE) { lightTheme = !lightTheme; initLabels(renderer); }
        if (b == PAD_BUTTON_CIRCLE) detailsOpen = false;
        if (b == PAD_BUTTON_CROSS) { if (detailsOpen) { queued = true; detailsOpen = false; } else detailsOpen = true; }
        if (!detailsOpen) {
            if (b == PAD_BUTTON_LEFT) selectedCard = (selectedCard + 5) % 6;
            if (b == PAD_BUTTON_RIGHT) selectedCard = (selectedCard + 1) % 6;
            if (b == PAD_BUTTON_L1) selectedFilter = (selectedFilter + 3) % 4;
            if (b == PAD_BUTTON_R1) selectedFilter = (selectedFilter + 1) % 4;
        }
    }
}

