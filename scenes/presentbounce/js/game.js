/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

goog.provide('app.Game');

goog.require('app.shared.Coordinator');
goog.require('app.shared.Gameover');
goog.require('app.shared.LevelUp');
goog.require('app.shared.pools');
goog.require('app.shared.Tutorial');

goog.require('app.Constants');
goog.require('app.Scoreboard');
goog.require('app.config.Levels');
goog.require('app.world.Level');




/**
 * Main game class
 * @param {!Element} elem An DOM element which wraps the game.
 * @constructor
 * @export
 */
app.Game = function(elem) {
  this.elem = $(elem);
  this.viewElem = this.elem.find('.scene');
  this.levelElem = this.elem.find('.levelboard');

  this.scoreboard = new app.Scoreboard(this, this.elem.find('.board'), app.Constants.TOTAL_LEVELS);
  this.gameoverView = new app.shared.Gameover(this, this.elem.find('.gameover'));
  this.levelUp = new app.shared.LevelUp(this, this.elem.find('.levelup'), this.elem.find('.levelup--number'));
  this.tutorial = new app.shared.Tutorial(this.elem, 'device-tilt', 'mouse');

  this.isPlaying = false;
  this.paused = false;
  this.scale = 1;
  this.gameStartTime = +new Date;

  // bind context
  this.onFrame_ = this.onFrame_.bind(this);
  this.loadNextLevel_ = this.loadNextLevel_.bind(this);

  // Bind listener to scale scene when window resizes
  this.watchSceneSize_();
};

/**
 * Starts the game.
 * @export
 */
app.Game.prototype.start = function() {
  this.restart();
  //this.tutorial.start();
};

/**
 * Resets all game entities and restarts the game. Can be called at any time.
 */
app.Game.prototype.restart = function() {
  var match = location.search.match(/[?&]level=(\d+)/) || [];
  this.level = (+match[1] || 1) - 2;
  this.paused = false;

  // Clear score board and load first (or chosen debug) level
  this.scoreboard.reset();
  this.loadNextLevel_();

  // Start game
  window.santaApp.fire('sound-trigger', 'gb_game_start');
  window.santaApp.fire('analytics-track-game-start', {gameid: 'presentbounce'});
  this.unfreezeGame();
};

/**
 * Game loop. Runs every frame using requestAnimationFrame.
 * @private
 */
app.Game.prototype.onFrame_ = function() {
  if (!this.isPlaying) {
    return;
  }

  // Calculate delta since last frame.
  var now = +new Date() / 1000;
  var delta = Math.min(1, now - this.lastFrame);
  this.lastFrame = now;

  // Update game state with physics simulations.
  this.currentLevel_.onFrame(delta);

  // Render game state.
  this.scoreboard.onFrame(delta);

  // Request next frame
  this.requestId = utils.requestAnimFrame(this.onFrame_);
};

/**
 * Transition to the next level.
 * @private
 */
app.Game.prototype.loadNextLevel_ = function() {
  // Next level
  this.level++;
  var levelNumber = this.level % app.config.Levels.length;

  var levelData = app.config.Levels[levelNumber];

  console.log('Game, level data', levelNumber , app.config.Levels);

  // Send Klang event
  if (this.level > 0) {
    window.santaApp.fire('sound-trigger', 'gb_level_up');
  }

  // Update scoreboard
  this.scoreboard.setLevel(this.level);
  this.scoreboard.restart();

  // Load new level
  if (this.currentLevel_) {
    this.currentLevel_.destroy();
  }
  this.currentLevel_ = new app.world.Level(this, this.levelElem, levelData, this.onLevelCompleted);
};


/**
 * Callback when current level is successfully completed
 * @param {!Number} score Final score of the completed level
 */
app.Game.prototype.onLevelCompleted = function(score) {

  this.scoreboard.addScore(score);

  // Check for game end
  if (this.level === app.config.Levels.length - 1) {
    this.gameover();
  } else {
    this.levelUp.show(this.level + 2, this.loadNextLevel_);
  }
};


/**
 * Freezes the game. Stops the onFrame loop and stops any CSS3 animations.
 * Used both for game over and pausing.
 */
app.Game.prototype.freezeGame = function() {
  this.isPlaying = false;
  this.elem.addClass('frozen');
};

/**
 * Unfreezes the game, starting the game loop as well.
 */
app.Game.prototype.unfreezeGame = function() {
  if (!this.isPlaying) {
    this.elem.removeClass('frozen').focus();

    this.isPlaying = true;
    this.lastFrame = +new Date() / 1000;
    this.requestId = utils.requestAnimFrame(this.onFrame_);
  }
};


/**
 * Stops the game as game over. Displays the game over screen as well.
 */
app.Game.prototype.gameover = function() {
  this.freezeGame();
  this.gameoverView.show();
  window.santaApp.fire('sound-trigger', 'gb_game_over');
  window.santaApp.fire('analytics-track-game-over', {
    gameid: 'presentbounce',
    score: this.scoreboard.score,
    level: this.level,
    timePlayed: new Date - this.gameStartTime
  });
};

/**
 * Pauses/unpauses the game.
 */
app.Game.prototype.togglePause = function() {
  if (this.paused) {
    this.resume();
  // Only allow pausing if the game is playing (not game over).
  } else if (this.isPlaying) {
    this.pause();
  }
};

/**
 * Pause the game.
 */
app.Game.prototype.pause = function() {
  this.paused = true;
  this.freezeGame();
};

/**
 * Resume the game.
 */
app.Game.prototype.resume = function() {
  this.paused = false;
  this.unfreezeGame();
};

/**
 * Scale the game down for smaller resolutions.
 * @param {number} scale A scale between 0 and 1 on how much to scale
 * @param {number} width The width.
 * @param {number} height The height.
 */
app.Game.prototype.setScale = function(scale, width, height) {
  this.scale = scale;
  this.windowWidth = width;
  this.windowHeight = height;
  this.viewElem.css({
    transform: 'scale(' + scale + ')',
    width: width / scale + 'px',
    height: height / scale + 'px'
  });
};

app.Game.prototype.getViewport = function () {
  return {
    scale: this.scale,
    width: this.windowWidth / this.scale,
    height: this.windowHeight / this.scale,
    windowWidth: this.windowWidth,
    windowHeight: this.windowHeight
  };
};

/**
 * Detects scene size and manages scale. Updates on window resize.
 * @private
 */
app.Game.prototype.watchSceneSize_ = function() {
  var bgElem = this.bgElem,
      game = this;

  var updateSize = function() {
    var width = window.innerWidth,
      height = window.innerHeight,
      scale = width < app.Constants.VIEWPORT_MIN_WIDTH ? 
          width / app.Constants.VIEWPORT_MIN_WIDTH : 
          1;
    
    scale = height < app.Constants.VIEWPORT_MIN_HEIGHT ?
        Math.min(height / app.Constants.VIEWPORT_MIN_HEIGHT, scale) :
        scale;

    game.setScale(scale, width, height);
  };

  updateSize();
  $(window).on('resize.presentbounce', updateSize);
};

/**
 * Cleanup
 * @export
 */
app.Game.prototype.dispose = function() {
  if (this.isPlaying) {
    window.santaApp.fire('analytics-track-game-quit', {
      gameid: 'presentbounce', timePlayed: new Date - this.gameStartTime, level: this.level
    });
  }
  
  utils.cancelAnimFrame(this.requestId);
  $(window).off('.presentbounce');
  $(document).off('.presentbounce');

  this.levelUp.dispose();
  this.tutorial.dispose();
};
