import * as easingFunctions from './easing-functions'

// CONSTANTS
const DEFAULT_EASING = 'linear'
const DEFAULT_DURATION = 500
const UPDATE_TIME = 1000 / 60
const root = typeof window !== 'undefined' ? window : global

const AFTER_TWEEN = 'afterTween'
const AFTER_TWEEN_END = 'afterTweenEnd'
const BEFORE_TWEEN = 'beforeTween'
const TWEEN_CREATED = 'tweenCreated'
const TYPE_FUNCTION = 'function'
const TYPE_STRING = 'string'

// requestAnimationFrame() shim by Paul Irish (modified for Shifty)
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
let scheduleFunction =
  root.requestAnimationFrame ||
  root.webkitRequestAnimationFrame ||
  root.oRequestAnimationFrame ||
  root.msRequestAnimationFrame ||
  (root.mozCancelRequestAnimationFrame && root.mozRequestAnimationFrame) ||
  setTimeout

const noop = () => {}

let listHead = null
let listTail = null

// Strictly used for testing
export const resetList = () => (listHead = listTail = null)
export const getListHead = () => listHead
export const getListTail = () => listTail

const formulas = { ...easingFunctions }

/**
 * Calculates the interpolated tween values of an Object for a given
 * timestamp.
 * @param {number} forPosition The position to compute the state for.
 * @param {Object} currentState Current state properties.
 * @param {Object} originalState: The original state properties the Object is
 * tweening from.
 * @param {Object} targetState: The destination state properties the Object
 * is tweening to.
 * @param {number} duration: The length of the tween in milliseconds.
 * @param {number} timestamp: The UNIX epoch time at which the tween began.
 * @param {Object<string|Function>} easing: This Object's keys must correspond
 * to the keys in targetState.
 * @returns {Object}
 * @private
 */
export const tweenProps = (
  forPosition,
  currentState,
  originalState,
  targetState,
  duration,
  timestamp,
  easing
) => {
  let easedPosition
  let easingObjectProp
  let start

  const normalizedPosition =
    forPosition < timestamp ? 0 : (forPosition - timestamp) / duration

  let easingFn = null
  let hasOneEase = false

  if (easing && easing.call) {
    hasOneEase = true
    easedPosition = easing(normalizedPosition)
  }

  for (const key in currentState) {
    if (!hasOneEase) {
      easingObjectProp = easing[key]
      easingFn = easingObjectProp.call
        ? easingObjectProp
        : formulas[easingObjectProp]

      easedPosition = easingFn(normalizedPosition)
    }

    start = originalState[key]

    currentState[key] = start + (targetState[key] - start) * easedPosition
  }

  return currentState
}

const processTween = (tween, currentTime) => {
  let timestamp = tween._timestamp
  const currentState = tween._currentState
  const delay = tween._delay

  if (currentTime < timestamp + delay) {
    return
  }

  let duration = tween._duration
  const targetState = tween._targetState

  const endTime = timestamp + delay + duration
  let timeToCompute = currentTime > endTime ? endTime : currentTime
  const hasEnded = timeToCompute >= endTime
  const offset = duration - (endTime - timeToCompute)
  const hasFilters = tween._filters.length > 0

  if (hasEnded) {
    tween._render(targetState, tween._data, offset)
    return tween.stop(true)
  }

  if (hasFilters) {
    tween._applyFilter(BEFORE_TWEEN)
  }

  // If the animation has not yet reached the start point (e.g., there was
  // delay that has not yet completed), just interpolate the starting
  // position of the tween.
  if (timeToCompute < timestamp + delay) {
    timestamp = duration = timeToCompute = 1
  } else {
    timestamp += delay
  }

  tweenProps(
    timeToCompute,
    currentState,
    tween._originalState,
    targetState,
    duration,
    timestamp,
    tween._easing
  )

  if (hasFilters) {
    tween._applyFilter(AFTER_TWEEN)
  }

  tween._render(currentState, tween._data, offset)
}

/**
 * Process all tweens currently managed by Shifty for the current tick. This
 * does not perform any timing or update scheduling; it is the logic that is
 * run *by* the scheduling functionality. Specifically, it computes the state
 * and calls all of the relevant {@link shifty.tweenConfig} functions supplied
 * to each of the tweens for the current point in time (as determined by {@link
 * shifty.Tweenable.now}.
 *
 * This is a low-level API that won't be needed in the majority of situations.
 * It is primarily useful as a hook for higher-level animation systems that are
 * built on top of Shifty. If you need this function, it is likely you need to
 * pass something like `() => {}` to {@link
 * shifty.Tweenable.setScheduleFunction}, override {@link shifty.Tweenable.now}
 * and manage the scheduling logic yourself.
 *
 * @method shifty.processTweens
 * @see https://github.com/jeremyckahn/shifty/issues/109
 */
export const processTweens = () => {
  let nextTweenToProcess

  const currentTime = Tweenable.now()
  let currentTween = listHead

  while (currentTween) {
    nextTweenToProcess = currentTween._next
    processTween(currentTween, currentTime)
    currentTween = nextTweenToProcess
  }
}

const getCurrentTime = Date.now || (() => +new Date())
let now

/**
 * Handles the update logic for one tick of a tween.
 * @param {number} [currentTimeOverride] Needed for accurate timestamp in
 * shifty.Tweenable#seek.
 * @private
 */
export const scheduleUpdate = () => {
  now = getCurrentTime()
  scheduleFunction.call(root, scheduleUpdate, UPDATE_TIME)

  processTweens()
}

/**
 * Creates a usable easing Object from a string, a function or another easing
 * Object.  If `easing` is an Object, then this function clones it and fills
 * in the missing properties with `"linear"`.
 *
 * If the tween has only one easing across all properties, that function is
 * returned directly.
 * @param {Object.<string|Function>} fromTweenParams
 * @param {Object|string|Function} [easing]
 * @param {Object} [composedEasing] Reused composedEasing object (used internally)
 * @return {Object.<string|Function>|Function}
 * @private
 */
export const composeEasingObject = (
  fromTweenParams,
  easing = DEFAULT_EASING,
  composedEasing = {}
) => {
  let typeofEasing = typeof easing

  if (formulas[easing]) {
    return formulas[easing]
  }

  if (typeofEasing === TYPE_STRING || typeofEasing === TYPE_FUNCTION) {
    for (const prop in fromTweenParams) {
      composedEasing[prop] = easing
    }
  } else {
    for (const prop in fromTweenParams) {
      composedEasing[prop] = easing[prop] || DEFAULT_EASING
    }
  }

  return composedEasing
}

// Private declarations used below

const remove = ((previousTween, nextTween) => tween => {
  // Adapted from:
  // https://github.com/trekhleb/javascript-algorithms/blob/7c9601df3e8ca4206d419ce50b88bd13ff39deb6/src/data-structures/doubly-linked-list/DoublyLinkedList.js#L73-L121
  if (tween === listHead) {
    listHead = tween._next

    if (listHead) {
      listHead._previous = null
    } else {
      listTail = null
    }
  } else if (tween === listTail) {
    listTail = tween._previous

    if (listTail) {
      listTail._next = null
    } else {
      listHead = null
    }
  } else {
    previousTween = tween._previous
    nextTween = tween._next

    previousTween._next = nextTween
    nextTween._previous = previousTween
  }

  // Clean up any references in case the tween is restarted later.
  tween._previous = tween._next = null
})()

const defaultPromiseCtor = typeof Promise === 'function' ? Promise : null

export class Tweenable {
  /**
   * @method shifty.Tweenable.now
   * @static
   * @returns {number} The current timestamp.
   */
  static now = () => now

  /**
   * @param {Object} [initialState={}] The values that the initial tween should
   * start at if a `from` value is not provided to {@link
   * shifty.Tweenable#tween} or {@link shifty.Tweenable#setConfig}.
   * @param {shifty.tweenConfig} [config] Configuration object to be passed to
   * {@link shifty.Tweenable#setConfig}.
   * @constructs shifty.Tweenable
   */
  constructor(initialState = {}, config = undefined) {
    this._config = {}
    this._data = {}
    this._delay = 0
    this._filters = []
    this._next = null
    this._previous = null
    this._timestamp = null
    this._resolve = null
    this._reject = null
    this._currentState = initialState || {}
    this._originalState = {}
    this._targetState = {}
    this._start = noop
    this._render = noop
    this._promiseCtor = defaultPromiseCtor

    // To prevent unnecessary calls to setConfig do not set default
    // configuration here.  Only set default configuration immediately before
    // tweening if none has been set.
    if (config) {
      this.setConfig(config)
    }
  }

  /**
   * Applies a filter to Tweenable instance.
   * @param {string} filterName The name of the filter to apply.
   * @private
   */
  _applyFilter(filterName) {
    for (let i = this._filters.length; i > 0; i--) {
      const filterType = this._filters[i - i]
      const filter = filterType[filterName]

      if (filter) {
        filter(this)
      }
    }
  }

  /**
   * Configure and start a tween. If this {@link shifty.Tweenable}'s instance
   * is already running, then it will stop playing the old tween and
   * immediately play the new one.
   * @method shifty.Tweenable#tween
   * @param {shifty.tweenConfig} [config] Gets passed to {@link
   * shifty.Tweenable#setConfig}.
   * @return {shifty.Tweenable}
   */
  tween(config = undefined) {
    if (this._isPlaying) {
      this.stop()
    }

    if (config || !this._config) {
      this.setConfig(config)
    }

    this._pausedAtTime = null
    this._timestamp = Tweenable.now()
    this._start(this.get(), this._data)

    if (this._delay) {
      this._render(this._currentState, this._data, 0)
    }

    return this._resume(this._timestamp)
  }

  /**
   * Configure a tween that will start at some point in the future. Aside from
   * `delay`, `from`, and `to`, each configuration option will automatically
   * default to the same option used in the preceding tween of this {@link
   * shifty.Tweenable} instance.
   * @method shifty.Tweenable#setConfig
   * @param {shifty.tweenConfig} [config={}]
   * @return {shifty.Tweenable}
   */
  setConfig(config = {}) {
    const { _config } = this

    for (const key in config) {
      _config[key] = config[key]
    }

    // Configuration options to reuse from previous tweens
    const {
      promise = this._promiseCtor,
      start = noop,
      finish,
      render = this._config.step || noop,

      // Legacy option. Superseded by `render`.
      step = noop,
    } = _config

    // Attach something to this Tweenable instance (e.g.: a DOM element, an
    // object, a string, etc.);
    this._data = _config.data || _config.attachment || this._data

    // Init the internal state
    this._isPlaying = false
    this._pausedAtTime = null
    this._scheduleId = null
    this._delay = config.delay || 0
    this._start = start
    this._render = render || step
    this._duration = _config.duration || DEFAULT_DURATION
    this._promiseCtor = promise

    if (finish) {
      this._resolve = finish
    }

    const { from, to = {} } = config
    const { _currentState, _originalState, _targetState } = this

    for (const key in from) {
      _currentState[key] = from[key]
    }

    let anyPropsAreStrings = false

    for (const key in _currentState) {
      const currentProp = _currentState[key]

      if (!anyPropsAreStrings && typeof currentProp === TYPE_STRING) {
        anyPropsAreStrings = true
      }

      _originalState[key] = currentProp

      // Ensure that there is always something to tween to.
      _targetState[key] = to.hasOwnProperty(key) ? to[key] : currentProp
    }

    this._easing = composeEasingObject(
      this._currentState,
      _config.easing,
      this._easing
    )

    this._filters.length = 0

    if (anyPropsAreStrings) {
      for (const key in Tweenable.filters) {
        if (Tweenable.filters[key].doesApply(this)) {
          this._filters.push(Tweenable.filters[key])
        }
      }

      this._applyFilter(TWEEN_CREATED)
    }

    return this
  }

  /**
   * Overrides any `finish` function passed via a {@link shifty.tweenConfig}.
   * @method shifty.Tweenable#then
   * @param {function} onFulfilled Receives {@link shifty.promisedData} as the
   * first parameter.
   * @param {function} onRejected Receives {@link shifty.promisedData} as the
   * first parameter.
   * @return {external:Promise}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then
   */
  then(onFulfilled, onRejected) {
    this._promise = new this._promiseCtor((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
    })

    return this._promise.then(onFulfilled, onRejected)
  }

  /**
   * @method shifty.Tweenable#catch
   * @param {function} onRejected Receives {@link shifty.promisedData} as the
   * first parameter.
   * @return {external:Promise}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch
   */
  catch(onRejected) {
    return this.then().catch(onRejected)
  }

  /**
   * @method shifty.Tweenable#get
   * @return {Object} The current state.
   */
  get() {
    return { ...this._currentState }
  }

  /**
   * Set the current state.
   * @method shifty.Tweenable#set
   * @param {Object} state The state to set.
   */
  set(state) {
    this._currentState = state
  }

  /**
   * Pause a tween. Paused tweens can be resumed from the point at which they
   * were paused. If a tween is not running, this is a no-op.
   * @method shifty.Tweenable#pause
   * @return {shifty.Tweenable}
   */
  pause() {
    if (!this._isPlaying) {
      return
    }

    this._pausedAtTime = Tweenable.now()
    this._isPlaying = false
    remove(this)

    return this
  }

  /**
   * Resume a paused tween.
   * @method shifty.Tweenable#resume
   * @return {shifty.Tweenable}
   */
  resume() {
    return this._resume()
  }

  _resume(currentTime = Tweenable.now()) {
    if (this._timestamp === null) {
      return this.tween()
    }

    if (this._isPlaying) {
      return this._promise
    }

    if (this._pausedAtTime) {
      this._timestamp += currentTime - this._pausedAtTime
      this._pausedAtTime = null
    }

    this._isPlaying = true

    if (listHead === null) {
      listHead = this
      listTail = this
    } else {
      this._previous = listTail
      listTail._next = this

      listTail = this
    }

    return this
  }

  /**
   * Move the state of the animation to a specific point in the tween's
   * timeline.  If the animation is not running, this will cause {@link
   * shifty.renderFunction} handlers to be called.
   * @method shifty.Tweenable#seek
   * @param {millisecond} millisecond The millisecond of the animation to seek
   * to.  This must not be less than `0`.
   * @return {shifty.Tweenable}
   */
  seek(millisecond) {
    millisecond = Math.max(millisecond, 0)
    const currentTime = Tweenable.now()

    if (this._timestamp + millisecond === 0) {
      return this
    }

    this._timestamp = currentTime - millisecond

    // Make sure that any render handlers are run.
    processTween(this, currentTime)

    return this
  }

  /**
   * Stops a tween. If a tween is not running, this is a no-op. This method
   * does not cancel the tween {@link external:Promise}. For that, use {@link
   * shifty.Tweenable#cancel}.
   * @param {boolean} [gotoEnd] If `false`, the tween just stops at its current
   * state.  If `true`, the tweened object's values are instantly set to the
   * target values.
   * @method shifty.Tweenable#stop
   * @return {shifty.Tweenable}
   */
  stop(gotoEnd = false) {
    if (!this._isPlaying) {
      return this
    }

    this._isPlaying = false

    remove(this)

    const hasFilters = this._filters.length > 0

    if (gotoEnd) {
      if (hasFilters) {
        this._applyFilter(BEFORE_TWEEN)
      }

      tweenProps(
        1,
        this._currentState,
        this._originalState,
        this._targetState,
        1,
        0,
        this._easing
      )

      if (hasFilters) {
        this._applyFilter(AFTER_TWEEN)
        this._applyFilter(AFTER_TWEEN_END)
      }
    }

    if (this._resolve) {
      this._resolve({
        data: this._data,
        state: this._currentState,
        tweenable: this,
      })
    }

    this._resolve = null
    this._reject = null

    return this
  }

  /**
   * {@link shifty.Tweenable#stop}s a tween and also `reject`s its {@link
   * external:Promise}. If a tween is not running, this is a no-op. Prevents
   * calling any provided `finish` function.
   * @param {boolean} [gotoEnd] Is propagated to {@link shifty.Tweenable#stop}.
   * @method shifty.Tweenable#cancel
   * @return {shifty.Tweenable}
   * @see https://github.com/jeremyckahn/shifty/issues/122
   */
  cancel(gotoEnd = false) {
    const { _currentState, _data, _isPlaying } = this

    if (!_isPlaying) {
      return this
    }

    if (this._reject) {
      this._reject({
        data: _data,
        state: _currentState,
        tweenable: this,
      })
    }

    this._resolve = null
    this._reject = null

    return this.stop(gotoEnd)
  }

  /**
   * Whether or not a tween is running.
   * @method shifty.Tweenable#isPlaying
   * @return {boolean}
   */
  isPlaying() {
    return this._isPlaying
  }

  /**
   * @method shifty.Tweenable#setScheduleFunction
   * @param {shifty.scheduleFunction} scheduleFunction
   * @deprecated Will be removed in favor of {@link shifty.Tweenable.setScheduleFunction} in 3.0.
   */
  setScheduleFunction(scheduleFunction) {
    Tweenable.setScheduleFunction(scheduleFunction)
  }

  /**
   * Get and optionally set the data that gets passed as `data` to {@link
   * shifty.promisedData}, {@link shifty.startFunction} and {@link
   * shifty.renderFunction}.
   * @param {Object} [data]
   * @method shifty.Tweenable#data
   * @return {Object} The internally stored `data`.
   */
  data(data = null) {
    if (data) {
      this._data = { ...data }
    }

    return this._data
  }

  /**
   * `delete` all "own" properties.  Call this when the {@link
   * shifty.Tweenable} instance is no longer needed to free memory.
   * @method shifty.Tweenable#dispose
   */
  dispose() {
    for (const prop in this) {
      delete this[prop]
    }
  }
}

// TODO: Make these proper static methods.

/**
 * Set a custom schedule function.
 *
 * By default,
 * [`requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window.requestAnimationFrame)
 * is used if available, otherwise
 * [`setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/Window.setTimeout)
 * is used.
 * @method shifty.Tweenable.setScheduleFunction
 * @param {shifty.scheduleFunction} fn The function to be
 * used to schedule the next frame to be rendered.
 * @return {shifty.scheduleFunction} The function that was set.
 */
Tweenable.setScheduleFunction = fn => (scheduleFunction = fn)

Tweenable.formulas = formulas

/**
 * The {@link shifty.filter}s available for use.  These filters are
 * automatically applied at tween-time by Shifty. You can define your own
 * {@link shifty.filter}s and attach them to this object.
 * @member shifty.Tweenable.filters
 * @type {Object.<shifty.filter>}
 */
Tweenable.filters = {}

/**
 * @method shifty.tween
 * @param {shifty.tweenConfig} [config={}]
 * @description Standalone convenience method that functions identically to
 * {@link shifty.Tweenable#tween}.  You can use this to create tweens without
 * needing to set up a {@link shifty.Tweenable} instance.
 *
 * ```
 * import { tween } from 'shifty';
 *
 * tween({ from: { x: 0 }, to: { x: 10 } }).then(
 *   () => console.log('All done!')
 * );
 * ```
 *
 * @returns {shifty.Tweenable} A new {@link shifty.Tweenable} instance.
 */
export function tween(config = {}) {
  const tweenable = new Tweenable()
  tweenable.tween(config)

  // This is strictly a legacy shim from when this function returned a Promise.
  // REMOVE THIS LINE IN THE NEXT MAJOR VERSION
  tweenable.tweenable = tweenable

  return tweenable
}

scheduleUpdate()
