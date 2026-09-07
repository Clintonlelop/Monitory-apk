package com.devicemanager.ui.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.devicemanager.R
import com.devicemanager.manager.PermissionManager
import com.google.android.material.card.MaterialCardView

/**
 * RecyclerView adapter for displaying permission status items.
 *
 * Each item shows: permission name, status (colored), description,
 * and a "Grant" button that opens the appropriate settings.
 */
class PermissionAdapter(
    private val onGrantClick: (PermissionManager.PermissionInfo) -> Unit
) : ListAdapter<PermissionManager.PermissionInfo, PermissionAdapter.PermissionViewHolder>(
    PermissionDiffCallback()
) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PermissionViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_permission, parent, false)
        return PermissionViewHolder(view)
    }

    override fun onBindViewHolder(holder: PermissionViewHolder, position: Int) {
        val permission = getItem(position)
        holder.bind(permission, onGrantClick)
    }

    class PermissionViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val cardView: MaterialCardView = itemView.findViewById(R.id.permissionCard)
        private val nameText: TextView = itemView.findViewById(R.id.permissionName)
        private val statusText: TextView = itemView.findViewById(R.id.permissionStatus)
        private val descriptionText: TextView = itemView.findViewById(R.id.permissionDescription)
        private val grantButton: Button = itemView.findViewById(R.id.grantButton)

        fun bind(
            permission: PermissionManager.PermissionInfo,
            onGrantClick: (PermissionManager.PermissionInfo) -> Unit
        ) {
            nameText.text = permission.displayName
            descriptionText.text = permission.description
            statusText.text = permission.status

            // Set status color
            val context = itemView.context
            when (permission.status) {
                "GRANTED" -> {
                    statusText.setTextColor(context.getColor(R.color.status_granted))
                    grantButton.visibility = View.GONE
                }
                "DENIED" -> {
                    statusText.setTextColor(context.getColor(R.color.status_denied))
                    grantButton.visibility = View.VISIBLE
                    grantButton.text = "Grant"
                }
                "REQUIRES_USER_ACTION" -> {
                    statusText.setTextColor(context.getColor(R.color.status_requires_action))
                    grantButton.visibility = View.VISIBLE
                    grantButton.text = if (permission.isSpecial) "Open Settings" else "Grant"
                }
                "NOT_AVAILABLE" -> {
                    statusText.setTextColor(context.getColor(R.color.status_not_available))
                    grantButton.visibility = View.GONE
                }
            }

            grantButton.setOnClickListener {
                onGrantClick(permission)
            }
        }
    }

    class PermissionDiffCallback : DiffUtil.ItemCallback<PermissionManager.PermissionInfo>() {
        override fun areItemsTheSame(
            oldItem: PermissionManager.PermissionInfo,
            newItem: PermissionManager.PermissionInfo
        ): Boolean = oldItem.key == newItem.key

        override fun areContentsTheSame(
            oldItem: PermissionManager.PermissionInfo,
            newItem: PermissionManager.PermissionInfo
        ): Boolean = oldItem == newItem
    }
}
