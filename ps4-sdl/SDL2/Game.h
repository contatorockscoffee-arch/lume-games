#pragma once

#include <SDL2/SDL.h>
#include <SDL2/SDL_image.h>
#include "Color.h"
#include "TTF.h"

extern Color bgColor;
extern Color fgColor;
extern FT_Face fontDebug;
extern FT_Face fontScore;
extern SDL_Joystick* controller;

enum ControllerButton {
    PAD_BUTTON_CROSS = 0,
    PAD_BUTTON_CIRCLE,
    PAD_BUTTON_SQUARE,
    PAD_BUTTON_TRIANGLE,
    PAD_BUTTON_L1,
    PAD_BUTTON_R1,
    PAD_BUTTON_OPTIONS = 9,
    PAD_BUTTON_UP = 11,
    PAD_BUTTON_DOWN,
    PAD_BUTTON_LEFT,
    PAD_BUTTON_RIGHT
};

void initGame(SDL_Renderer* renderer);
void render(SDL_Renderer* renderer);
void update(SDL_Renderer* renderer, int deltaFrameTicks, int totalFrameCount, int totalTickCount);

