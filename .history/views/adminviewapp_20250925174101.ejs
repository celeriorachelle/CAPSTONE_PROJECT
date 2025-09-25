<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>View Appointments | Everlasting Peace Memorial Park</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="/stylesheets/adminviewapp.css">
</head>
<body>
  <header class="admin-header">
    <h1>Admin Dashboard</h1>
    <nav>
      <ul>
        <li><a href="/admin"><i class="fas fa-home"></i> Home</a></li>
        <li><a href="/adminviewapp" class="active"><i class="fas fa-calendar-alt"></i> Appointments</a></li>
        <li><a href="/burialrecord"><i class="fas fa-book"></i> Bookings</a></li>
        <li><a href="/logout"><i class="fas fa-sign-out-alt"></i> Logout</a></li>
      </ul>
    </nav>
  </header>

  <main class="admin-main">
    <aside class="sidebar">
      <h3><i class="fas fa-calendar-check"></i> Appointments</h3>
      <ul>
        <li><a href="/admin"><i class="fas fa-home"></i> Dashboard Home</a></li>
        <li><a href="/admincreateb"><i class="fas fa-plus-circle"></i> Create Appointment</a></li>
        <li><a href="/adminviewapp" class="active"><i class="fas fa-list"></i> View Appointments</a></li>
        <li><a href="/burialrecord"><i class="fas fa-book"></i> Burial Records</a></li>
        <li><a href="/maps"><i class="fas fa-map"></i> Cemetery Map</a></li>
        <li><a href="/adminviewapp/installments/reminders"><i class="fas fa-bell"></i> Installment Reminders</a></li>
      </ul>

      <h3><i class="fas fa-filter"></i> Filter by Status</h3>
      <div class="filters">
        <button onclick="filterStatus('all')" class="active" id="filter-all">
          <i class="fas fa-list"></i> All Appointments
        </button>
        <button onclick="filterStatus('pending')" id="filter-pending">
          <i class="fas fa-clock"></i> Pending
        </button>
        <button onclick="filterStatus('reserved')" id="filter-reserved">
          <i class="fas fa-bookmark"></i> Reserved
        </button>
        <button onclick="filterStatus('occupied')" id="filter-occupied">
          <i class="fas fa-user-slash"></i> Occupied
        </button>
        <button onclick="filterStatus('cancelled')" id="filter-cancelled">
          <i class="fas fa-times-circle"></i> Cancelled
        </button>
      </div>
    </aside>

    <section class="content">
      <div class="content-header">
        <h2>Plot Bookings</h2>
        <div class="search-controls">
          <div class="search-bar">
            <i class="fas fa-search"></i>
            <input type="text" placeholder="Search plot bookings..." id="searchPlot">
          </div>
        </div>
      </div>

      <table class="appointments-table" id="plotTable">
        <thead>
          <tr>
            <th>ID</th><th>Client</th><th>Service</th><th>Date</th><th>Status</th><th>Payment</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <% plotBookings.forEach(a => { %>
          <tr>
            <td><%= a.id %></td>
            <td><%= a.clientName %></td>
            <td><%= a.service %></td>
            <td><%= a.date ? new Date(a.date).toLocaleDateString() : '' %></td>
            <td><%= a.displayStatus %></td>
            <td>
              <%= a.paymentStatus %> <br>
              Paid: ₱<%= a.totalPaid.toFixed(2) %> <br>
              Price: ₱<%= a.totalAmount.toFixed(2) %> <br>
              Min Down: ₱<%= a.minDownPayment.toFixed(2) %>
            </td>
            <td>
              <button class="btn-action btn-view" onclick="viewDetails(<%= a.id %>, true)">
                <i class="fas fa-eye"></i>
              </button>
            </td>
          </tr>
          <% }) %>
        </tbody>
      </table>

      <h2>Burial & Memorial Bookings</h2>
      <div class="search-controls">
        <div class="search-bar">
          <i class="fas fa-search"></i>
          <input type="text" placeholder="Search burial/memorial..." id="searchBurial">
        </div>
      </div>

      <table class="appointments-table" id="burialTable">
        <thead>
          <tr>
            <th>ID</th><th>Client</th><th>Service</th><th>Date</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          <% burialMemorialBookings.forEach(a => { %>
          <tr>
            <td><%= a.id %></td>
            <td><%= a.clientName %></td>
            <td><%= a.service %></td>
            <td><%= a.date ? new Date(a.date).toLocaleDateString() : '' %></td>
            <td><%= a.displayStatus %></td>
          </tr>
          <% }) %>
        </tbody>
      </table>

    </section>

    <!-- Modal for Plot Booking Details -->
    <div id="appointmentModal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3><i class="fas fa-info-circle"></i> Appointment Details</h3>
          <span class="close" onclick="closeModal()">&times;</span>
        </div>
        <div id="appointmentDetails"></div>
      </div>
    </div>

  </main>

<script>
  const plotBookings = <%- JSON.stringify(plotBookings) %>;
  const burialBookings = <%- JSON.stringify(burialMemorialBookings) %>;

  function viewDetails(id, isPlot) {
    const apt = (isPlot ? plotBookings : burialBookings).find(a => a.id == id);
    if (!apt) return;

    let html = `
      <p><strong>Client:</strong> ${apt.clientName}</p>
      <p><strong>Email:</strong> ${apt.email}</p>
      <p><strong>Phone:</strong> ${apt.phone}</p>
      <p><strong>Service:</strong> ${apt.service}</p>
      <p><strong>Status:</strong> ${apt.displayStatus}</p>
    `;

    if (isPlot) {
      html += `
        <p><strong>Payment Status:</strong> ${apt.paymentStatus}</p>
        <p><strong>Total Paid:</strong> ₱${apt.totalPaid.toFixed(2)}</p>
        <p><strong>Price:</strong> ₱${apt.totalAmount.toFixed(2)}</p>
        <p><strong>Min Downpayment:</strong> ₱${apt.minDownPayment.toFixed(2)}</p>
        <p><strong>Plot:</strong> ${apt.plot_number || '—'} (${apt.location || '—'})</p>
      `;
    }

    document.getElementById('appointmentDetails').innerHTML = html;
    document.getElementById('appointmentModal').style.display = 'block';
  }

  function closeModal() {
    document.getElementById('appointmentModal').style.display = 'none';
  }

  // Simple search for each table
  document.getElementById('searchPlot').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#plotTable tbody tr');
    rows.forEach(r => {
      r.style.display = [...r.children].some(td => td.innerText.toLowerCase().includes(term)) ? '' : 'none';
    });
  });

  document.getElementById('searchBurial').addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#burialTable tbody tr');
    rows.forEach(r => {
      r.style.display = [...r.children].some(td => td.innerText.toLowerCase().includes(term)) ? '' : 'none';
    });
  });
</script>

</body>
</html>
