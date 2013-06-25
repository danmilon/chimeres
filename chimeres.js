#!/usr/bin/env node
var request = require('request')
  , cheerio = require('cheerio')
  , url = require('url')
  , qs = require('querystring')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits

var BASE_URL = 'http://data.chimeres.info/cbox/shoutpop.php'

function ChimeresChat() {
  if (!(this instanceof ChimeresChat)) {
    return new ChimeresChat()
  }

  EventEmitter.call(this)

  this._lastKnownShout = null
  this._knownShouts = []

  var self = this

  setImmediate(function () {
    self._fetch(function (err, shouts) {
      if (err) {
        self.emit('error', err)
      }

      this._knownShouts = shouts
      this._lastKnownShout = shouts[shouts.length - 1]

      shouts.forEach(self._emitShout.bind(self))

      self.emit('initRefresh')

      setInterval(self._checkAndRefresh.bind(self), 1000)
    })
  })
}

inherits(ChimeresChat, EventEmitter)

ChimeresChat.prototype._emitShout = function (shout) {
  this.emit('message', shout)
}

ChimeresChat.prototype._fetch = function (cb) {
  request({
    uri: BASE_URL,
    qs: {
      action: 'retrieve'
    }
  }, function (err, resp, body) {
    if (err) {
      return cb(err)
    }

    var $ = cheerio.load(body)

    var shoutsDOM = $('.shout')
      , shouts = []

    shoutsDOM.each(function () {
      var shout = $(this)

      var sender = shout.find('.screenname').text().slice(0, -1)
        , message = shout.find('.message')
        , dateAndIp = shout.attr('title')

      var datetime = dateAndIp.match(/([0-9:pmam]+) \[(.+)\]/)
        , time = datetime[1]
        , date = datetime[2]

      message.find('img').each(function () {
        var img = $(this)

        img.replaceWith(img.attr('alt'))
      })

      message.find('a').each(function () {
        var link = $(this)

        link.replaceWith(link.attr('href'))
      })

      message = message.text()

      shouts.push({
        sender: sender,
        message: message,
        time: time,
        date: date
      })
    })

    var lastShoutId = parseInt(body.match(/shoutchat_lastRenderedShout = (.+);/)[1], 10)
    if (Number.isNaN(lastShoutId)) {
      return cb(new Error('invalid lastShoutId'))
    }

    shouts[shouts.length - 1].id = lastShoutId

    cb(null, shouts)
  })
}

ChimeresChat.prototype.post = function (data, cb) {
  var self = this

  request({
    uri: BASE_URL,
    method: 'POST',
    form: {
      action: 'shout',
      message: data.message,
      screenname: data.name
    }
  }, function (err, resp) {
    if (err) {
      return cb(err)
    }

    if (resp.statusCode !== 302 || !resp.headers.location) {
      return cb(new Error('invalid response'))
    }

    var location = url.parse(resp.headers.location).query
      , lastShoutId = qs.parse(location).fresh

    lastShoutId = parseInt(lastShoutId, 10)

    if (Number.isNaN(lastShoutId)) {
      return cb(new Error('invalid last shout id'))
    }

    setImmediate(self._refresh.bind(self))

    return cb(null, lastShoutId)
  })
}

ChimeresChat.prototype._refresh = function (cb) {
  var self = this

  this._fetch(function (err, shouts) {
    if (err) {
      return cb(err)
    }

    this._knownShouts = shouts

    var shoutEmit = false

    for (var i = 0; i < shouts.length; i++) {
      var shout = shouts[i]

      if (shoutEmit) {
        self.emit('message', shout)
      }

      var lastKnownShout = self._lastKnownShout

      if (shout.sender === lastKnownShout.sender &&
          shout.message === lastKnownShout.message &&
          shout.time === lastKnownShout.time &&
          shout.date === lastKnownShout.date) {
        shoutEmit = true
      }
    }

    this._lastKnownShout = shouts[shouts.length - 1]
  })
}

ChimeresChat.prototype._check = function (cb) {
  request({
    uri: BASE_URL,
    qs: {
      action: 'check',
      channel: 'main',
      numLines: '40'
    }
  }, function (err, resp) {
    if (err) {
      return cb(err)
    }

    var lastShoutId = parseInt(resp.headers['x-last-shout'], 10)

    if (Number.isNaN(lastShoutId)) {
      return cb(new Error('invalid x-last-shout value: ' + resp.headers['x-last-shout']))
    }

    return cb(null, lastShoutId)
  })
}

ChimeresChat.prototype._checkAndRefresh = function () {
  var self = this

  this._check(function (err, lastShoutId) {
    if (err) {
      throw err
    }

    if (this._lastKnownShout.id < lastShoutId) {
      self._refresh(function (err) {
        throw err
      })
    }
  })
}

exports.Chat = ChimeresChat

function schedule(cb) {
  request('http://chimeres.info', function (err, resp, body) {
    if (err) {
      return cb(err)
    }

    var $ = cheerio.load(body)
      , scheduleBox = $('.homebox img').parent()
      , daysDOM = scheduleBox.html().split('<img src="/static/images/point.png" alt""="">')
    
    // first element is useless space
    daysDOM.shift()

    var days = []
    
    for (var i = 0; i < daysDOM.length; i++) {
      var dayText = $(daysDOM[i]).text().replace(/^(\s*)|()$/gm, '')
      days.push(dayText)
    }

    cb(null, days)
  })
}

exports.schedule = schedule
