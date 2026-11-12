(function () {
  'use strict';

  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var updated = document.getElementById('updated');
  var queueDate = document.getElementById('queueDate');
  var connection = document.getElementById('connection');
  var connectionText = document.getElementById('connectionText');
  var socketConnected = false;
  var hasLoaded = false;
  var loading = false;
  var again = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setConnection(state, message) {
    connection.className = 'connection' +
      (state === 'online' ? ' connection--online' : '') +
      (state === 'offline' ? ' connection--offline' : '');
    connectionText.textContent = message;
  }

  function card(physician) {
    var section = el('section', 'physician-card');
    var heading = el('div', 'physician-heading');
    var details = el('div');
    var status = String(physician.status || 'FREE').toUpperCase();
    var occupied = status === 'OCCUPIED';
    var specialty = physician.specialty || 'Physician';
    var nextUp = Array.isArray(physician.nextUp) ? physician.nextUp : [];

    details.appendChild(el('h3', 'physician-name', physician.name || 'Physician'));
    details.appendChild(el(
      'p',
      'physician-specialty',
      specialty + (physician.department ? ' · ' + physician.department : '')
    ));

    heading.appendChild(details);
    heading.appendChild(el(
      'span',
      'status' + (occupied ? ' status--occupied' : ''),
      occupied ? 'OCCUPIED' : 'FREE'
    ));
    section.appendChild(heading);

    var ticketArea = el('div', 'ticket-area');
    ticketArea.appendChild(el('div', 'ticket-label', 'NOW SERVING'));
    ticketArea.appendChild(el(
      'div',
      'ticket-number' + (physician.nowServing ? '' : ' ticket-number--idle'),
      physician.nowServing || 'No ticket called'
    ));
    ticketArea.appendChild(el(
      'div',
      'ticket-hint',
      physician.nowServing
        ? 'Please proceed when your ticket is called.'
        : 'Ready for the next patient.'
    ));
    section.appendChild(ticketArea);

    var summary = el('div', 'queue-summary');
    var waiting = el('div', 'waiting-count');
    waiting.appendChild(el('strong', '', String(Number(physician.waitingCount) || 0)));
    waiting.appendChild(document.createTextNode(' waiting'));
    summary.appendChild(waiting);

    var next = el('div', 'next-queue');
    next.appendChild(el('div', 'next-label', 'Up next'));
    var nextTickets = el('div', 'next-tickets');

    if (nextUp.length) {
      nextUp.forEach(function (ticketNumber) {
        nextTickets.appendChild(el('span', 'next-ticket', ticketNumber));
      });
    } else {
      nextTickets.appendChild(el('div', 'next-empty', 'No patients waiting'));
    }

    next.appendChild(nextTickets);
    summary.appendChild(next);
    section.appendChild(summary);

    return section;
  }

  function formatDate(value) {
    var dateParts = String(value || '').split('-');
    if (dateParts.length !== 3) return value || 'Today';

    var date = new Date(
      Number(dateParts[0]),
      Number(dateParts[1]) - 1,
      Number(dateParts[2])
    );

    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(date);
  }

  function load() {
    if (loading) {
      again = true;
      return;
    }

    loading = true;

    fetch('/queue/status')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.physicians)) {
          throw new Error('Invalid queue response');
        }

        grid.replaceChildren.apply(grid, data.physicians.map(card));
        empty.hidden = data.physicians.length > 0;
        queueDate.textContent = formatDate(data.date);
        updated.textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString(
          undefined,
          { hour: 'numeric', minute: '2-digit' }
        );
        hasLoaded = true;
        setConnection(
          'online',
          socketConnected ? 'Live updates on' : 'Connected · checking for updates'
        );
      })
      .catch(function () {
        setConnection('offline', 'Connection issue · retrying');
        updated.textContent = hasLoaded
          ? 'Showing the last available update'
          : 'Waiting for queue data…';
      })
      .finally(function () {
        loading = false;
        if (again) {
          again = false;
          load();
        }
      });
  }

  var socket = io();

  socket.on('connect', function () {
    socketConnected = true;
    load();
    if (hasLoaded) setConnection('online', 'Live updates on');
  });

  socket.on('disconnect', function () {
    socketConnected = false;
    setConnection(hasLoaded ? 'offline' : '', 'Reconnecting…');
  });

  socket.on('connect_error', function () {
    socketConnected = false;
    setConnection(hasLoaded ? 'offline' : '', 'Reconnecting…');
  });

  ['queue:updated', 'physician:status', 'ticket:called'].forEach(function (eventName) {
    socket.on(eventName, load);
  });

  load();
  setInterval(load, 30000);
})();
