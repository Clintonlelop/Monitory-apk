package com.example.ui.screens

import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.example.DeviceManagerApp
import com.example.ui.viewmodel.MainViewModel
import com.example.ui.viewmodel.Screen
import java.io.File
import java.text.DateFormat
import java.util.Date

private data class StorageEntry(
    val uri: Uri,
    val name: String,
    val mimeType: String?,
    val size: Long,
    val modified: Long,
    val isDirectory: Boolean,
    /** Non-null when the entry was listed via direct File access (all-files mode). */
    val file: File? = null
)

@Composable
fun StorageBrowserScreen(viewModel: MainViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val storagePrefs = remember { context.getSharedPreferences("storage_browser", android.content.Context.MODE_PRIVATE) }
    var selectedTree by remember { mutableStateOf(storagePrefs.getString("selected_tree_uri", null)?.let(Uri::parse)) }
    var currentDirectory by remember { mutableStateOf<Uri?>(null) }
    var entries by remember { mutableStateOf<List<StorageEntry>>(emptyList()) }
    var selectedEntry by remember { mutableStateOf<StorageEntry?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val directoryStack = remember { mutableStateListOf<Uri>() }

    // Direct File browsing (no folder picker) when "All files access" is granted.
    var allFilesAccess by remember {
        mutableStateOf(
            (context.applicationContext as DeviceManagerApp).repository.permissionsHelper.isAllFilesAccessGranted()
        )
    }
    var currentFileDir by remember { mutableStateOf<File?>(null) }
    val fileStack = remember { mutableStateListOf<File>() }

    // Re-check when returning from the Settings screen the button opens.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                val granted =
                    (context.applicationContext as DeviceManagerApp).repository.permissionsHelper.isAllFilesAccessGranted()
                if (granted != allFilesAccess) {
                    allFilesAccess = granted
                    if (granted) {
                        selectedTree = null
                        currentDirectory = null
                        currentFileDir = null
                        fileStack.clear()
                    } else {
                        currentFileDir = null
                        fileStack.clear()
                        entries = emptyList()
                    }
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun loadFileDirectory(dir: File) {
        try {
            val files = dir.listFiles()
            entries = (files ?: emptyArray()).map { f ->
                StorageEntry(
                    uri = Uri.fromFile(f),
                    name = f.name,
                    mimeType = if (f.isDirectory) {
                        DocumentsContract.Document.MIME_TYPE_DIR
                    } else {
                        MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "*/*"
                    },
                    size = if (f.isFile) f.length() else 0L,
                    modified = f.lastModified(),
                    isDirectory = f.isDirectory,
                    file = f
                )
            }.sortedWith(
                compareByDescending<StorageEntry> { it.isDirectory }.thenBy { it.name.lowercase() }
            )
            currentFileDir = dir
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't read this folder: ${e.localizedMessage ?: "access denied"}"
            entries = emptyList()
        }
    }

    fun loadDirectory(tree: Uri, directory: Uri) {
        try {
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                tree,
                (if (directory == tree) DocumentsContract.getTreeDocumentId(tree) else DocumentsContract.getDocumentId(directory))
            )
            val results = mutableListOf<StorageEntry>()
            context.contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                ),
                null,
                null,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC"
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val nameCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mimeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
                val sizeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)
                val modifiedCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                while (cursor.moveToNext()) {
                    val id = cursor.getString(idCol)
                    val mime = cursor.getString(mimeCol)
                    results += StorageEntry(
                        uri = DocumentsContract.buildDocumentUriUsingTree(tree, id),
                        name = cursor.getString(nameCol) ?: "(unnamed)",
                        mimeType = mime,
                        size = if (cursor.isNull(sizeCol)) 0L else cursor.getLong(sizeCol),
                        modified = if (cursor.isNull(modifiedCol)) 0L else cursor.getLong(modifiedCol),
                        isDirectory = mime == DocumentsContract.Document.MIME_TYPE_DIR
                    )
                }
            }
            entries = results
            currentDirectory = directory
            errorMessage = null
        } catch (e: Exception) {
            errorMessage = "Couldn't read this folder: ${e.localizedMessage ?: "access denied"}"
            entries = emptyList()
        }
    }

    LaunchedEffect(selectedTree) {
        val tree = selectedTree
        if (tree != null && currentDirectory == null && !allFilesAccess) {
            directoryStack.clear()
            directoryStack.add(tree)
            loadDirectory(tree, tree)
        }
    }

    LaunchedEffect(allFilesAccess) {
        if (allFilesAccess && currentFileDir == null) {
            val root = Environment.getExternalStorageDirectory()
            fileStack.clear()
            fileStack.add(root)
            loadFileDirectory(root)
        }
    }

    val folderPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // Some document providers grant read-only access; keep the grant they supplied.
            }
            selectedTree = uri
            storagePrefs.edit().putString("selected_tree_uri", uri.toString()).apply()
            directoryStack.clear()
            directoryStack.add(uri)
            loadDirectory(uri, uri)
        }
    }

    val stat = remember {
        runCatching {
            val stats = StatFs(Environment.getExternalStorageDirectory().absolutePath)
            Triple(stats.totalBytes, stats.availableBytes, stats.totalBytes - stats.availableBytes)
        }.getOrElse { Triple(0L, 0L, 0L) }
    }
    val total = stat.first
    val free = stat.second
    val used = stat.third
    val usedFraction = if (total > 0) used.toFloat() / total.toFloat() else 0f
    fun sizeLabel(bytes: Long): String = when {
        bytes >= 1024L * 1024 * 1024 -> String.format("%.2f GB", bytes / (1024.0 * 1024 * 1024))
        bytes >= 1024L * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024))
        bytes >= 1024L -> String.format("%.1f KB", bytes / 1024.0)
        else -> "$bytes B"
    }

    Scaffold(modifier = modifier.fillMaxSize()) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                IconButton(onClick = { viewModel.navigateTo(Screen.Dashboard) }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to dashboard")
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text("Storage & Files", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        if (allFilesAccess) "Browsing internal shared storage (All files access granted)"
                        else "Browse folders you choose on this device",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }

            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Storage, contentDescription = null)
                        Text("  Internal shared storage", fontWeight = FontWeight.SemiBold)
                    }
                    Text("${sizeLabel(used)} used · ${sizeLabel(free)} free")
                    LinearProgressIndicator(progress = { usedFraction }, modifier = Modifier.fillMaxWidth())
                    Text("Total capacity: ${sizeLabel(total)}", style = MaterialTheme.typography.bodySmall)
                }
            }

            if (allFilesAccess) {
                Text(
                    "Full storage browsing is active. Folders open directly below — no folder picker needed.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                Button(onClick = { folderPicker.launch(selectedTree) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.FolderOpen, contentDescription = null)
                    Text(if (selectedTree == null) "Choose folder to browse" else "Choose another folder")
                }
                OutlinedButton(
                    onClick = {
                        (context.applicationContext as DeviceManagerApp)
                            .repository.permissionsHelper.openAllFilesAccessSettings()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Lock, contentDescription = null)
                    Text("Grant All files access (browse everything)")
                }
                Text(
                    "Without All files access, Android only grants access to the folder you select and its descendants. Protected app folders may be blocked by Android.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            val hasContent = allFilesAccess || currentDirectory != null
            if (hasContent) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (allFilesAccess) currentFileDir?.absolutePath ?: "Storage contents"
                        else "Selected folder contents",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedButton(
                        onClick = {
                            if (allFilesAccess) {
                                if (fileStack.size > 1) {
                                    fileStack.removeAt(fileStack.lastIndex)
                                    loadFileDirectory(fileStack.last())
                                }
                            } else {
                                val tree = selectedTree
                                if (tree != null && directoryStack.size > 1) {
                                    directoryStack.removeAt(directoryStack.lastIndex)
                                    loadDirectory(tree, directoryStack.last())
                                }
                            }
                        },
                        enabled = if (allFilesAccess) fileStack.size > 1 else directoryStack.size > 1
                    ) { Text("Up") }
                }
                if (errorMessage != null) {
                    Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                } else if (entries.isEmpty()) {
                    Text("This folder is empty, or no items could be listed.", style = MaterialTheme.typography.bodyMedium)
                }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(entries, key = { it.uri.toString() }) { entry ->
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable {
                                if (entry.isDirectory) {
                                    if (allFilesAccess) {
                                        entry.file?.let {
                                            fileStack.add(it)
                                            loadFileDirectory(it)
                                        }
                                    } else {
                                        val tree = selectedTree
                                        if (tree != null) {
                                            directoryStack.add(entry.uri)
                                            loadDirectory(tree, entry.uri)
                                        }
                                    }
                                } else {
                                    selectedEntry = entry
                                }
                            }
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    if (entry.isDirectory) Icons.Default.Folder else Icons.Default.InsertDriveFile,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                    Text(entry.name, fontWeight = FontWeight.Medium)
                                    Text(
                                        if (entry.isDirectory) "Folder" else "${entry.mimeType ?: "File"} · ${sizeLabel(entry.size)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    if (entry.modified > 0) {
                                        Text(
                                            "Modified ${DateFormat.getDateTimeInstance().format(Date(entry.modified))}",
                                            style = MaterialTheme.typography.labelSmall
                                        )
                                    }
                                }
                                if (!entry.isDirectory) Icon(Icons.Default.OpenInNew, contentDescription = "View details")
                            }
                        }
                    }
                }
            } else {
                Spacer(Modifier.height(4.dp))
                Text("Choose a folder to view its files, sizes, types, and modified dates.")
            }
        }
    }

    selectedEntry?.let { entry ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { selectedEntry = null },
            title = { Text(entry.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Type: ${entry.mimeType ?: "Unknown"}")
                    Text("Size: ${sizeLabel(entry.size)}")
                    Text("Last modified: ${if (entry.modified > 0) DateFormat.getDateTimeInstance().format(Date(entry.modified)) else "Unknown"}")
                    Text("Location: ${entry.file?.absolutePath ?: (entry.uri.lastPathSegment ?: "Selected folder")}")
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    try {
                        val viewUri: Uri = if (entry.file != null) {
                            FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                entry.file
                            )
                        } else {
                            entry.uri
                        }
                        val openIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(viewUri, entry.mimeType ?: "*/*")
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        context.startActivity(openIntent)
                    } catch (_: Exception) {
                        Toast.makeText(context, "No app can open this file.", Toast.LENGTH_SHORT).show()
                    }
                    selectedEntry = null
                }) { Text("Open file") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { selectedEntry = null }) { Text("Close") }
            }
        )
    }
}
