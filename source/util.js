/**
=========================================================================
 Class Monitor
 =========================================================================
*/
function Monitor() {
    var that = {
        get_name: function () {
            return this._waitors || (this._waitors = []);
        },
        registerTimeout: function (target, timeout) {
            //debug('register timeout');
            var self = this;
            if (this._timeoutList == null) {
                this._timeoutList = {};
            }
            this._timeoutList[target.uniqid] = setTimeout(function () {
                self.timeoutHandler(target);
            }, timeout);
        },
        unregisterTimeout: function (thread) {
            if (this._timeoutList == null) return;
            var id = this._timeoutList[thread.uniqid];
            if (id != undefined && id != null) {
                clearTimeout(id);
                delete this._timeoutList[thread.uniqid];
            }
        },
        getWaitors: function () {
            return this._waitors || (this._waitors = []);
        },
        wait: function (timeout) {
            if (!timeout) timeout = 0;
            var thread = Thread.getCurrentThread();
            thread.monitorWait(timeout != 0, this);
            this.getWaitors().push(thread);
            if (timeout != 0) this.registerTimeout(thread, timeout);
        },
        notifyAll: function () {
            //debug('monitor notifyAll');
            if (this._waitors == null || this._waitors.length < 1) {
                return;
            }
            //debug(this._waitors);
            for (var i in this._waitors) {
                var t = this._waitors[i];
                this.unregisterTimeout(t);
                t.monitorWakeup(this);
            }
            this._waitors = null;
        },
        timeoutHandler: function (thread) {
            if (this._waitors == null || this._waitors.length < 1) return;
            var index = this._waitors.toString().indexOf(thread);
            if (index == -1) return;
            this._waitors.splice(index, 1);
            thread.monitorTimeout();
            clearTimeout(this._timeoutList[thread.uniqid]);
            this._timeoutId = null;
        },
        leave: function (thread) {
            if (this._waitors == null || this._waitors.length < 1) return;
            var index = this._waitors.toString().indexOf(thread);
            if (index == -1) return;
            this._waitors.splice(index, 1);
            this.unregisterTimeout(thread);
        },
        _waitors: [],
        _timeoutId: null,
        _timeoutList: null
    };
    return that;
}


function EventDispatcher (target) {
    var that = {};
    that.events = {}
    that.target = target || null;
    that.addEventListener = function (type, listener, useCapture) {
        this.events[type] = listener;
    };
    that.removeEventListener = function (type, listener, useCapture) {
        this.events[type] = null;
    };
    that.dispatchEvent = function (type) {
        if (this.events[type]) {
            this.events[type].apply(this.target || this, [type]);
        }
    }
    return that;
};



/**
=========================================================================
 Class Thread
 =========================================================================
*/
function Thread() {};

(function (Thread) {
    var ThreadState = {
        NEW: 0,
        RUNNABLE: 1,
        WAITING: 2,
        TIMED_WAITING: 3,
        TERMINATING: 4,
        TERMINATED: 5
    }
    Thread.threads = [];
    Thread.intervalId = null;
    Thread.count = 0;
    Thread._currentThread = null;

    Thread.initialize = function (frameRate) {
        Thread.frameRate = frameRate;
        Thread.interval = 1000 / this.frameRate;
        Thread.intervalId = setInterval(Thread.executeAllThreads, Thread.interval);
    };

    Thread.getCurrentThread = function () {
        return Thread._currentThread;
    };

    Thread.executeAllThreads = function () {
        var tCount = Thread.threads.length;
        var threads = Thread.threads;
        for (var i = 0; i < tCount;) {
            var t = threads[i];
            if (!t.execute()) {
                threads.splice(i, 1);
                tCount--;
            } else {
                i++;
            }
        }
    };

    Thread.addTopLevelThread = function (th) {
        Thread.threads.push(th);
    };

    Thread.addTopLevelThreads = function (th) {
        Thread.threads.push.apply(Thread.threads, th);
    };

    Thread.checkInterrupted = function () {
        var current = Thread.getCurrentThread();
        var status = current._isInterrupted;
        if (status) {
            current._isInterrupted = false;
        }
        return status;
    };

    Thread.interrupted = function (func) {
        Thread.getCurrentThread()._interruptedHandler = func;
        // if(Thread._currentThread) Thread.getCurrentThread()._interruptedHandler = func;
    };

    Thread.create = function () {
        var that = {
            uniqid: 'thread' + Thread.count++,
            _runHandler: null,
            _interruptedHandler: null,
            _eventHandlers: null,
            _state: ThreadState.NEW,
            _runningState: ThreadState.NEW,
            _sleepMonitor: null,
            _waitMonitor: null,
            _joinMonitor: null,
            _eventMonitor: null,
            _isInterrupted: false,
            _childs: null,
            _event: null,
            run: function () {
                //debug(this.id);
            },
            next: function (func) {
                this._runHandler = func
            },
            start: function () {
                //debug('start');
                this._state = ThreadState.RUNNABLE;
                this._runningState = ThreadState.RUNNABLE;
                this._runHandler = this.run;
                var current = Thread.getCurrentThread();
                if (current != null) {
                    current.addChild(this);
                } else {
                    Thread.addTopLevelThread(this);
                }
            },
            execute: function () {
                switch (this._state) {
                case ThreadState.NEW:
                    return true;
                    break;
                case ThreadState.TERMINATED:
                    return false;
                    break;
                default:
                    if (this._childs != null) {
                        var l = this._childs.length;
                        for (var i = 0; i < l;) {
                            var child = this._childs[i];
                            if (!child.execute()) {
                                this._childs.splice(i, 1);
                                l--;
                            } else {
                                i++;
                            }
                        }
                    }
                    return this._execute();
                    break;
                }
            },
            _execute: function () {
                if (this._state == ThreadState.WAITING) {
                    return true;
                }
                var runHandler = null;
                if (this._runHandler != null) {
                    runHandler = this._runHandler;
                }
                this._runHandler = null;
                this._interruptedHandler = null;
                this.resetEventHandler();
                if (runHandler != null) {
                    Thread._currentThread = this;
                    if (this._event != null) {
                        var ev = this._event;
                        runHandler.apply(this, [ev]);
                    } else {
                        runHandler.call(this);
                    }
                    Thread._currentThread = null;
                }
                if (this._eventHandlers != null && this._eventHandlers.length > 0) {
                    var i = this._eventHandlers.length;
                    while (i--) {
                        var eHandler = this._eventHandlers[i];
                        eHandler.register();
                    }
                    if (this._runHandler == null) {
                        if (this._waitMonitor == null) {
                            Thread._currentThread = this;
                            this.getEventMonitor().wait();
                        }
                    }
                }
                if (this._runHandler != null) {} else {
                    if (this._state == ThreadState.WAITING) {} else if (this._runningState == ThreadState.TERMINATING) {
                        if (this._childs != null) {
                            Thread.addTopLevelThreads(this._childs);
                            this._childs = null;
                        }
                        this._state = ThreadState.TERMINATED;
                        this._runningState = ThreadState.TERMINATED;
                        if (this._joinMonitor != null) {
                            this._joinMonitor.notifyAll();
                            this._joinMonitor = null;
                        }
                        return false;
                    } else {
                        this._runningState = ThreadState.TERMINATING;
                        this._state = ThreadState.TERMINATING;
                        this._runHandler = this.finalize;
                    }
                }
                return true;
            },
            finalize: function () {
                //debug('finalize');
            },
            interrupt: function () {
                if (this._state == ThreadState.WAITING || ThreadState.TIMED_WATING) {
                    this._waitMonitor.leave(this);
                    this._waitMonitor = null;
                    this._state = this._runningState;
                    //this._isInterrupted = true;
                    if (this._interruptedHandler != null) {
                        this._runHandler = this._interruptedHandler;
                    }
                } else {
                    this._isInterrupted = true;
                }
            },
            sleep: function (d) {
                if (this._sleepMonitor == null) {
                    this._sleepMonitor = Monitor();
                }
                this._state = ThreadState.WAITING;
                this._sleepMonitor.wait(d);
            },
            join: function (timeout) {
                if (!timeout) timeout = 0;
                if (this._state == ThreadState.TERMINATED) {
                    return false;
                }
                this.getJoinMonitor().wait(timeout);
                return true;
            },
            event: function (dispatcher, type, func) {
                this.addEventHandler(dispatcher, type, func);
            },
            monitorWait: function (timeout, monitor) {
                this._state = ThreadState.WAITING;
                this._waitMonitor = monitor;
            },
            monitorWakeup: function (monitor) {
                this._state = this._runningState;
                this._waitMonitor = null;
            },
            monitorTimeout: function (monitor) {
                this._state = ThreadState.RUNNABLE;
                this._waitMonitor = null;
            },
            addChild: function (th) {
                this.getChildren().push(th);
            },
            getChildren: function (thread) {
                return this._childs || (this._childs = []);
            },
            getJoinMonitor: function () {
                return this._joinMonitor || (this._joinMonitor = Monitor());
            },
            getEventMonitor: function () {
                return this._eventMonitor || (this._eventMonitor = Monitor());
            },
            getEventHandlers: function () {
                return this._eventHandlers || (this._eventHandlers = []);
            },
            addEventHandler: function (dispatcher, type, func) {
                this.getEventHandlers().push(EventHandler(dispatcher, type, this.eventHandler, func, this));
            },
            resetEventHandler: function () {
                if (this._eventHandlers == null) return;
                var i = this._eventHandlers.length;
                while (i--) {
                    var handler = this._eventHandlers[i];
                    handler.unregister();
                }
                this._eventHandlers.length = 0;
            },
            reset: function () {
                this._runHandler = null;
                this._interruptedHandler = null;
                this._eventHandlers = null;
                this._state = ThreadState.NEW;
                this._runningState = ThreadState.NEW;
                this._sleepMonitor = null;
                this._joinMonitor = null;
                this._eventMonitor = null;
                this._isInterrupted = false;
                this._childs = null;
            },
            eventHandler: function (e, handler) {
                //var self =Thread._currentThread;
                this._event = e;
                this._runHandler = handler.func;
                this.resetEventHandler();
                if (this._waitMonitor != null) {
                    this._waitMonitor.leave(this);
                    this._waitMonitor = null;
                }
                this._state = this._runningState;
                this._execute(null, this);
            },
            toString: function () {
                return 'Thread';
            }
        };
        return that;
    }

    function EventHandler (dispatcher, type, listener, func, thread) {
        var that = {
            dispatcher: dispatcher,
            type: type,
            listener: listener,
            func: func,
            thread: thread,
            register: function () {
                this.dispatcher.addEventListener(this.type, this.handler);
            },
            unregister: function () {
                this.dispatcher.removeEventListener(this.type, this.handler);
            }
        };
        that.handler = function (e) {
            that.listener.apply(thread, [e, that]);
        }
        return that;
    };
}(Thread));

Thread.initialize(30);