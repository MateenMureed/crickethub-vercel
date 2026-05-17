package com.crickethub.app.offline.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun OfflineHomeRoute(viewModel: OfflineHomeViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    OfflineHomeScreen(
        uiState = uiState,
        onRefresh = viewModel::refreshSilently,
    )
}

@Composable
fun OfflineHomeScreen(
    uiState: OfflineHomeUiState,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (!uiState.online) {
            Text(
                text = "Offline mode - showing cached data",
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                color = Color(0xFFF59E0B),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0x33F59E0B))
                    .padding(8.dp),
            )
        }

        if (uiState.initialLoading) {
            repeat(5) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text("Loading cached content...", modifier = Modifier.padding(14.dp))
                }
            }
            return@Column
        }

        val snapshot = uiState.snapshot
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(snapshot?.matches.orEmpty()) { match ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = "${match.teamAName} vs ${match.teamBName}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = match.status.uppercase(), style = MaterialTheme.typography.labelSmall)
                            Text(text = match.resultSummary ?: "No result yet", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
